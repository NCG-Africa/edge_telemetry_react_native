// Trace and span core (§6, #98) — shared by both builds, because none of it is
// platform-specific. It owns three things:
//
//   1. the carrier: the one root that is currently live, plus its 2 s idle / 10 s cap expiry;
//   2. root minting — `launch` at construction, `navigation` at a view entry with no live
//      root, `request` at a send with no live root. (`interaction` arrives with #102/#103.)
//   3. the key builders for the three tiers (§6.3), so no call site hand-assembles them.
//
// ⚠ **No request tag and no thread-local.** Android needs both because OkHttp runs its
// interceptors on a dispatcher pool thread; both RN builds patch a single-threaded JS
// transport, so a plain field read synchronously inside the patch is correct *by
// construction* (§6.7). Android's process-global `lastRoot` is unnecessary for the same
// reason: the crash and unhandled-rejection handlers read this carrier directly.
//
// The carrier is a field on a `Telemetry`-owned instance rather than a module-level `let`,
// which is the one deliberate departure from §6.7's wording. The substance it asks for —
// synchronous plain read, no tag, no thread-local — is unchanged; a module singleton would
// instead let one `Telemetry` inherit another's live root inside a single process, which is
// the hazard that actually exists here. `ViewManager` is owned the same way, for the same
// reason.

import { randomHex } from "../core/utils/uuid";
import {
    allowsHost,
    formatTraceparent,
    normalizeAllowlist,
    parseTraceparent,
    type TraceOutcome,
} from "./traceHeader";

/** §6.1's four root types. `interaction` has no producer until the interaction tickets. */
export type TraceRootType = "launch" | "interaction" | "navigation" | "request";

/**
 * Android's numbers unchanged (§6.7), and **internal constants, never `TelemetryOpts`
 * surface**. The case for raising the cap is chained requests on poor networks; it was
 * rejected on Android's own logic — `injected_expired` exists so the numbers are
 * falsifiable. Ship these, watch the expired ratio, tune on evidence.
 */
const ROOT_IDLE_MS = 2000;
const ROOT_CAP_MS = 10000;

type Root = {
    traceId: string;
    spanId: string;
    rootType: TraceRootType;
    /** The liveness clock's origin — always `Date.now()` at mint, never a reported value. */
    startedAt: number;
    /** The reported `span.start_time`. Differs from `startedAt` only for `launch` on web. */
    spanStartMs: number;
    lastTouch: number;
};

/** A flat bag of wire keys. An absent key means the SDK had nothing (§6.1). */
export type TraceAttributes = Record<string, string | number>;

/** What the interceptor observed at `send()`, and nothing it had to interpret. */
export type RequestTraceCtx = {
    url: string;
    /** An unsampled session injects no header at all (§6.5). Sampling stays session-level. */
    sampled: boolean;
    /**
     * The consumer's own `traceparent`, captured by the interceptor **at their write time**.
     * Absent (not empty-string) means they set none — never sniffed back off the request.
     */
    consumerTraceparent?: string | null;
    /** fetch-only. `mode` is a fetch concept XHR cannot express, so native never sets it. */
    noCors?: boolean;
};

export type RequestTrace = {
    /** The one header value to write, or nothing at all. Never a `flags=00` placeholder. */
    header?: string;
    finish: (endedAt: number) => TraceAttributes;
};

/** 32 lowercase hex, W3C (§6.1). */
const mintTraceId = () => randomHex(32);
/** 16 lowercase hex, W3C (§6.1). */
const mintSpanId = () => randomHex(16);

export class TraceManager {
    private root?: Root;
    /** Bare hosts, punycode-normalized, ports ignored. Empty by default: v4 is dark on upgrade. */
    private readonly allowlist: ReadonlySet<string>;
    /** Kept whether or not it is still the carrier: `app.start` reports it at any age. */
    private launch: Root;

    /**
     * @param launchStartMs what `app.start` reports as `span.start_time` — and **neither
     * value is a fork time** (§6.2). Web passes `performance.timeOrigin` (true navigation
     * start); native leaves it defaulted to `initialize()`, because everything before the
     * JS bundle loads is invisible and JS cannot see process fork. Do not compare the two
     * platforms' launch envelopes as if they measured the same interval.
     */
    constructor(launchStartMs?: number, traceHostAllowlist?: string[]) {
        // Constructor-only (§6.4). Normalized once, here, so a malformed entry throws at the
        // one moment a developer is looking — not on the first request to a typo'd host.
        this.allowlist = normalizeAllowlist(traceHostAllowlist);
        const now = Date.now();
        // Minted here and not at `app.start`'s emit, because the initial view opens in the
        // same `Telemetry` constructor and has to parent to it: a view minting its own root
        // there would make a web hard load report `navigation` (§6.2).
        this.launch = this.mint("launch", now, launchStartMs ?? now);
    }

    /**
     * §4.1's `sdk.trace_allowlist_size` — **count only, never the hosts**, so an operator can
     * tell "nobody opted in" apart from "the header is being stripped" without the SDK
     * shipping a customer's internal hostnames to the collector.
     */
    allowlistSize(): number {
        return this.allowlist.size;
    }

    /**
     * `app.start`'s own row — a root, so `span.id === rum.action.id` and there is no
     * `parent.span.id`. No `span.duration_ms` either: roots derive theirs server-side.
     */
    launchRootAttributes(): TraceAttributes {
        return spanKeys(this.launch, true, this.launch.spanStartMs).keys;
    }

    /**
     * Tier 1 for a `view`, captured at view **entry** — the action that opened the screen,
     * not the one that closed it (§6.3). A **point span**: `span.start_time` and never
     * `span.duration_ms`, because view dwell is not span duration and a width here would
     * stretch every tap-that-navigates envelope across the whole time the user sat there.
     */
    viewSpan(entryAt: number): TraceAttributes {
        const { root, isRoot } = this.attach("navigation", entryAt);
        return spanKeys(root, isRoot, entryAt).keys;
    }

    /**
     * Tier 1 for an `http.request`, captured at **send** — the root live then is the parent,
     * and `span.start_time` is the send — plus §6.5's outcome ladder and the one header the
     * SDK ever writes. Returns the finisher, so duration is stamped from the same pair of
     * timestamps the row's `http.duration_ms` uses.
     *
     * ponytail: a `send()` that throws synchronously never calls the finisher, so a root it
     * minted lives on for up to 2 s with no row describing it. Rare enough to leave; give
     * the finisher a `discard()` sibling if the orphan ratio ever shows up.
     */
    requestTrace(startedAt: number, ctx: RequestTraceCtx): RequestTrace {
        const decision = this.decide(ctx);

        // `adopted` is the consumer's trace, not ours: §6.1 says `span.id` mirrors the
        // foreign parent-id and `parent.span.id` is omitted, so the row is root-shaped inside
        // *their* trace. The carrier is deliberately left untouched — extending a local root
        // from a request that reports foreign ids would attribute their action to ours.
        if (decision === "adopted") {
            const foreign = parseTraceparent(ctx.consumerTraceparent)!;
            const keys: TraceAttributes = {
                "trace.id": foreign.traceId,
                "span.id": foreign.spanId,
                "rum.action.id": foreign.spanId,
                "span.start_time": new Date(startedAt).toISOString(),
                "traceparent.outcome": "adopted",
            };
            return { finish: () => keys };
        }

        // **Every skip still stamps local ids with no wire header** (§6.5) — that is what
        // makes "missing DB join ⇒ header stripped in transit" computable, so attribution
        // runs before the ladder is resolved and regardless of what it says.
        const { root, isRoot, attribution } = this.attach("request", startedAt);
        const outcome: TraceOutcome | undefined =
            decision === "inject" ? attribution : decision;
        const span = spanKeys(root, isRoot, startedAt);
        const keys: TraceAttributes = {
            ...span.keys,
            ...(outcome ? { "traceparent.outcome": outcome } : {}),
        };
        // `span.duration_ms` is Tier 1 **children only** (§6.1) — a root's is derived.
        const finish = isRoot
            ? () => keys
            : (endedAt: number) => ({ ...keys, "span.duration_ms": Math.max(0, endedAt - startedAt) });

        return decision === "inject"
            ? { finish, header: formatTraceparent(root.traceId, span.spanId) }
            : { finish };
    }

    /**
     * §6.5's ladder above the `injected_*` split, in table order — the precedence *is* the
     * order of these returns. `undefined` means the attribute is omitted entirely: absent
     * means not traced, which is the honest report for a consumer who never opted in and for
     * a sampled-out session (which injects no header at all, not a `flags=00` id).
     */
    private decide(ctx: RequestTraceCtx): TraceOutcome | "inject" | undefined {
        if (this.allowlist.size === 0 || !ctx.sampled) return undefined;
        if (!allowsHost(this.allowlist, ctx.url)) return "skipped_off_allowlist";
        // Outranks `skipped_consumer_set` because a `no-cors` request's headers guard drops
        // the *consumer's* traceparent too — mirroring its ids would manufacture a false
        // correlation against a header no server ever saw.
        if (ctx.noCors) return "skipped_no_cors";
        // Never-strip: ownership is the consumer's **write-time presence flag**, recorded by
        // the interceptor when they set it — never inferred from the value's shape, because
        // an SDK-minted and a consumer-minted traceparent are byte-identical by construction.
        if (ctx.consumerTraceparent != null) {
            return parseTraceparent(ctx.consumerTraceparent) ? "adopted" : "skipped_consumer_set";
        }
        return "inject";
    }

    /**
     * Tier 2 — annotation-only (§6.3): join the trace without occupying a span. No
     * `span.id`, no parent, no duration, and **no minting** — §6.2 lists the four events
     * that mint and these are not among them, so an untraced crash carries no trace keys
     * rather than inventing a root nothing else will ever join.
     */
    annotate(now: number = Date.now()): TraceAttributes {
        const live = this.liveRoot(now);
        if (!live) return {};
        return {
            "trace.id": live.traceId,
            "rum.action.id": live.spanId,
            "trace.root_type": live.rootType,
        };
    }

    /**
     * Drop the carrier. Background clears it on both builds, so a resumed app's first fetch
     * mints its own root rather than joining an action from before the user left (§6.2);
     * session rotation clears it because `trace.id` never spans a `session.id` (§6.6).
     */
    clear(): void {
        this.root = undefined;
    }

    /**
     * Retire the launch root and mint a replacement, keeping the *reported* launch time —
     * the process really did start then. For a session rotation that lands **before**
     * `app.start`, which is the expired-record cold launch and therefore §4.3's most common
     * path of all.
     *
     * Clearing alone would not do: `app.start` reports the launch root at any age, so its
     * root row would ship under the **new** session while the initial `view` it fathered
     * shipped under the **old** one. `trace.id` would span a `session.id` (§6.6, invariant 2)
     * and `GROUP BY rum.action.id` would never reassemble the launch envelope. Re-minting
     * keeps the retired trace wholly inside the retired session.
     *
     * ⚠ The retired trace then has children and no root row — the initial `view` row is a
     * rootless child. That is the same condition process death already produces by design
     * (a killed view emits nothing), and it is the cheaper of the two wrongs.
     */
    restartLaunchRoot(): void {
        this.launch = this.mint("launch", Date.now(), this.launch.spanStartMs);
    }

    /**
     * Join the live root, or mint one of `mintAs`. A span's *start* extends the root.
     *
     * `attribution` is read **before** `liveRoot()` drops an expired carrier, which is the
     * only place the two unattributed causes are still distinguishable: a carrier that just
     * aged out is `injected_expired` (context lost), no carrier at all is
     * `injected_unattributed` (no action) — the split §6.5 asks the backend to keep.
     */
    private attach(mintAs: TraceRootType, now: number): {
        root: Root;
        isRoot: boolean;
        attribution: "injected_attributed" | "injected_expired" | "injected_unattributed";
    } {
        const hadCarrier = this.root !== undefined;
        const live = this.liveRoot(now);
        if (live) {
            live.lastTouch = now;
            return { root: live, isRoot: false, attribution: "injected_attributed" };
        }
        return {
            root: this.mint(mintAs, now, now),
            isRoot: true,
            attribution: hadCarrier ? "injected_expired" : "injected_unattributed",
        };
    }

    private mint(rootType: TraceRootType, now: number, spanStartMs: number): Root {
        const root: Root = {
            traceId: mintTraceId(),
            spanId: mintSpanId(),
            rootType,
            startedAt: now,
            spanStartMs,
            lastTouch: now,
        };
        this.root = root;
        return root;
    }

    /**
     * The carrier if it is still live, dropping it otherwise. Both boundaries are strict —
     * a root sitting exactly on one has not crossed it — matching the session boundaries.
     *
     * A **negative** delta is clamped to expired (§6.7): `Date.now()` can move backwards on
     * an NTP correction, and reading that as "fresh" would hold one root open indefinitely.
     */
    private liveRoot(now: number): Root | undefined {
        const root = this.root;
        if (!root) return undefined;
        const idle = now - root.lastTouch;
        const age = now - root.startedAt;
        if (idle < 0 || age < 0 || idle > ROOT_IDLE_MS || age > ROOT_CAP_MS) {
            this.root = undefined;
            return undefined;
        }
        return root;
    }
}

/**
 * §6.1's identity, in one place so no call site can get it wrong: `rum.action.id` is the
 * root's `span.id` — **equal to `span.id` on a root and to `parent.span.id` on a child**.
 * That is the single thing that makes an action's envelope one `GROUP BY` and not a
 * self-join. `trace.root_type` is denormalized onto every child so launch traffic separates
 * from tap traffic without joining back to the root.
 */
function spanKeys(root: Root, isRoot: boolean, spanStartMs: number): { keys: TraceAttributes; spanId: string } {
    const spanId = isRoot ? root.spanId : mintSpanId();
    return {
        spanId,
        keys: {
            "trace.id": root.traceId,
            "span.id": spanId,
            ...(isRoot ? {} : { "parent.span.id": root.spanId }),
            "rum.action.id": root.spanId,
            "trace.root_type": root.rootType,
            "span.start_time": new Date(spanStartMs).toISOString(),
        },
    };
}
