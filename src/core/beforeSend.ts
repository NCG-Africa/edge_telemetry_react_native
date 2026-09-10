import { debug } from "./debug";
import type { TelemetryEvent } from "./telemetry";

/**
 * The consumer's scrubbing hook (§3.6). One event, **synchronous**, run at **enqueue**.
 *
 * Enqueue and not flush: a failed send persists the batch through the `Store`, so a
 * flush-time hook would let unscrubbed PII hit disk — and on native that disk outlives
 * the process. Synchronous because `app.crash` flushes during teardown and a
 * Promise-returning hook would put a host `await` in a dying app's path.
 */
export type BeforeSend = (event: TelemetryEvent) => TelemetryEvent | null;

export type HookOutcome =
    | { kind: "kept"; event: TelemetryEvent }
    | { kind: "dropped" }    // returned null — the hook working as intended (sdk.hook_dropped)
    | { kind: "failed" };    // threw — fail closed (sdk.hook_failed)

/**
 * Tier A — immutable. Re-stamped from the original after the hook returns, never
 * defended by throwing: the realistic hook is `delete attrs[k]` in a loop and the
 * realistic failure is over-deletion, so an over-broad hook must not be able to get a
 * consumer's whole feed silently discarded behind a 2xx.
 *
 * A writable `eventName` would also restore the public path to `app.crash` that the
 * allowlist removes on purpose.
 */
const TIER_A_KEYS = new Set([
    // `session.sequence` is not in the contract's §3.6 list because that list was written
    // against v4's `event.sequence`, which this SDK does not emit yet. Both are transmission
    // ordinals with no scrubbing use case, and (session.id, session.sequence) is what orders
    // a session's batches (#92) — a hook that could delete it would order nothing.
    "session.id", "session.start_time", "session.sequence", "event.sequence",
    "device.platform", "trace.id", "span.id", "parent.span.id",
    "rum.action.id", "view.id",
]);
const isTierA = (key: string) =>
    TIER_A_KEYS.has(key) || key.startsWith("sdk.") || key.startsWith("app.");

/**
 * Tier B — rewritable, not deletable. Hashing `device.id` to a tenant-local id is a
 * legitimate ask; deleting it 400s the entire batch at the collector (§2.3).
 * Everything else is Tier C and untouched — that is where the PII actually lives.
 */
const TIER_B_KEY = "device.id";

/** Run the hook and enforce the tiers on what comes back. */
export function applyBeforeSend(original: TelemetryEvent, hook: BeforeSend): HookOutcome {
    let returned: TelemetryEvent | null;
    try {
        // The hook gets a copy, never `original`. The realistic hook is `delete
        // attrs[k]` in a loop, and re-stamping from an object the hook already mutated
        // would restore nothing — the tier table would be decorative.
        returned = hook({ ...original, attributes: { ...original.attributes } });
    } catch (err) {
        // Fail closed. Sending the original would ship the exact field the hook existed
        // to remove, which is the one outcome a broken scrubber must never produce.
        debug.warn("Telemetry: beforeSend threw — event dropped", err);
        return { kind: "failed" };
    }
    // Only an explicit `null` is the documented "drop this row". Anything else the hook
    // hands back that isn't an event — `undefined` from a forgotten `return`, a string,
    // a number — is a *bug*, and counting it as dropped would inflate the "my rule is
    // working" counter with the exact case §3.6 says the two counters exist to separate.
    if (returned === null) return { kind: "dropped" };
    if (typeof returned !== "object") {
        debug.warn("Telemetry: beforeSend returned a non-event — event dropped", returned);
        return { kind: "failed" };
    }
    return { kind: "kept", event: restamp(original, returned) };
}

/** Replace the Tier A slice wholesale — that covers deletion and forgery in one pass. */
function restamp(original: TelemetryEvent, returned: TelemetryEvent): TelemetryEvent {
    const attributes: Record<string, any> = {};
    for (const [k, v] of Object.entries(returned.attributes ?? {})) {
        if (!isTierA(k)) attributes[k] = v;
    }
    for (const [k, v] of Object.entries(original.attributes ?? {})) {
        if (isTierA(k)) attributes[k] = v;
    }
    // Not just `undefined`: a hook writing `null` or `""` here 400s the batch exactly the
    // same way `delete` does, so anything that isn't a usable id is treated as a deletion.
    const rewritten = attributes[TIER_B_KEY];
    if (typeof rewritten !== "string" || rewritten === "") {
        const originalId = original.attributes?.[TIER_B_KEY];
        if (originalId === undefined) delete attributes[TIER_B_KEY];
        else attributes[TIER_B_KEY] = originalId;
    }

    // Built key by key rather than spread: a hook that bolts `metricName` onto an event
    // must not be able to move a row onto the metric path.
    const kept: TelemetryEvent = {
        type: original.type,
        timestamp: original.timestamp,
        attributes,
    };
    if (original.eventName !== undefined) kept.eventName = original.eventName;
    if (original.metricName !== undefined) kept.metricName = original.metricName;
    // `value` is Tier C — rewritable — but a metric without one is not a metric.
    if (original.type === "metric") kept.value = returned.value ?? original.value;
    return kept;
}
