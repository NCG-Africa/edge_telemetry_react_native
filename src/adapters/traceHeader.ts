// Distributed trace header injection (§6.4/§6.5, #99) — the pure half: allowlist
// normalization, `traceparent` parse/format and header reading. Shared by both builds; the
// stateful half (attribution, which decides *which* `injected_*` rung fires) lives on
// TraceManager, which owns the carrier.
//
// **`traceparent` only. No `b3`, no `tracestate`, ever.** The SDK reads exactly one header
// name, for exactly one purpose (a presence check), and writes exactly one header name. That
// is a sentence a consumer must be able to state during a security review, so it is enforced
// by there being no other header name anywhere in this file.

import { debug, isDev } from "../core/debug";

/** Lowercase on purpose: header names are compared case-insensitively (§6.4). */
export const TRACEPARENT = "traceparent";

/** §6.5's ladder. Precedence is declaration order; **absent means not traced**. */
export type TraceOutcome =
    | "skipped_off_allowlist"
    | "skipped_no_cors"          // fetch-only: `mode` is a concept XHR cannot express
    | "skipped_consumer_set"     // consumer header present and **unparseable**
    | "adopted"                  // consumer header present and **valid**
    | "injected_attributed"
    | "injected_expired"
    | "injected_unattributed";

// A malformed allowlist entry throws in dev and is dropped in production (§6.4) — a stated
// divergence from Android's unconditional `require`, because a RUM SDK crashing a shipped
// banking app over a config typo is the one failure worse than no tracing at all. `isDev`
// itself lives in core/debug, shared with §4.8's stackTraceLimit advisory.

/**
 * A **bare host**: no scheme, no path, no port, no wildcard. Ports are ignored by matching
 * too — ⚠ a deliberate mismatch with `http.host`, which keeps the port. Do not join them.
 *
 * `new URL()` does the punycode fold, so a unicode entry and a unicode URL land on the same
 * ASCII string. An IPv6 literal contains `:` and is therefore rejected; bare hosts only.
 */
function normalizeHost(entry: unknown): string | undefined {
    if (typeof entry !== "string") return undefined;
    const raw = entry.trim();
    if (!raw || /[\s/?#@*:]/.test(raw)) return undefined;
    try {
        const host = new URL(`http://${raw}`).hostname;
        return host || undefined;
    } catch {
        return undefined;
    }
}

/**
 * Constructor-only, exact match, empty by default — v4 is **dark on upgrade**, so nobody's
 * CORS breaks until they opt in. Listing a host is the consumer's assertion that that host
 * allows the header; that is why regexes and predicates were rejected rather than deferred.
 */
export function normalizeAllowlist(entries: unknown): ReadonlySet<string> {
    const out = new Set<string>();
    if (entries === undefined || entries === null) return out;
    if (!Array.isArray(entries)) {
        if (isDev()) throw new Error("traceHostAllowlist must be an array of bare hosts");
        debug.warn("Telemetry: traceHostAllowlist must be an array of bare hosts — ignored");
        return out;
    }
    for (const entry of entries) {
        const host = normalizeHost(entry);
        if (host) { out.add(host); continue; }
        if (isDev()) {
            throw new Error(
                `traceHostAllowlist: "${String(entry)}" is not a bare host (no scheme, path, port or wildcard)`
            );
        }
        debug.warn(`Telemetry: traceHostAllowlist entry "${String(entry)}" is not a bare host — dropped`);
    }
    return out;
}

/** Matching is on `hostname` — **ports ignored**, exact-only, no wildcards, no same-origin exemption. */
export function allowsHost(allowlist: ReadonlySet<string>, url: string): boolean {
    if (allowlist.size === 0) return false;
    const base = (globalThis as any).location?.href;
    try {
        return allowlist.has((base ? new URL(url, base) : new URL(url)).hostname);
    } catch {
        return false;   // a relative URL with no base has no host to allow
    }
}

/**
 * W3C `traceparent`, version `00`. Used for exactly one decision: is the consumer's own
 * header valid (`adopted`) or not (`skipped_consumer_set`)? An all-zero trace-id or span-id
 * is invalid by the spec. ⚠ Its price, said out loud: Android *repairs* a malformed consumer
 * header; §6.4's never-strip forbids that here, so it goes out broken and is unattributed on
 * both ends — visible in the outcome distribution rather than silently fixed.
 */
export function parseTraceparent(value: string | null | undefined): { traceId: string; spanId: string } | undefined {
    if (typeof value !== "string") return undefined;
    const m = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/.exec(value.trim());
    if (!m || /^0+$/.test(m[1]) || /^0+$/.test(m[2])) return undefined;
    return { traceId: m[1], spanId: m[2] };
}

/** Flags are always `01`: an unsampled session injects no header at all, not a `flags=00` id. */
export function formatTraceparent(traceId: string, spanId: string): string {
    return `00-${traceId}-${spanId}-01`;
}

/** Walks every `HeadersInit` shape without needing a `Headers` constructor to exist. */
function forEachHeader(headers: unknown, fn: (name: string, value: string) => void): void {
    if (!headers) return;
    if (Array.isArray(headers)) {
        for (const pair of headers) if (pair) fn(String(pair[0]), String(pair[1]));
    } else if (typeof (headers as any).forEach === "function") {
        (headers as any).forEach((v: string, k: string) => fn(String(k), String(v)));   // Headers
    } else if (typeof headers === "object") {
        for (const [k, v] of Object.entries(headers as object)) fn(k, String(v));
    }
}

/** Presence check only — the one purpose §6.4's read-scope invariant permits. */
export function readHeader(headers: unknown, name: string): string | undefined {
    let found: string | undefined;
    forEachHeader(headers, (k, v) => { if (k.toLowerCase() === name) found = v; });
    return found;
}

/**
 * A **copy** with our header appended. The consumer's `Headers`/`Request`/object is never
 * mutated, which is how never-strip is satisfied by construction rather than by discipline.
 * An array of pairs is a valid `HeadersInit` everywhere, so no `Headers` global is required.
 */
export function withHeader(headers: unknown, name: string, value: string): [string, string][] {
    const out: [string, string][] = [];
    forEachHeader(headers, (k, v) => out.push([k, v]));
    out.push([name, value]);
    return out;
}
