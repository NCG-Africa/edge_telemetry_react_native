import type { StoreRead } from "../core/store";
import { evictIndex, type TelemetryEvent } from "../core/telemetry";

// The offline queue's shared, platform-agnostic half (#89). Both senders keep failed
// batches under one key; only the Store underneath them differs, so the decoding rules
// live here once and stay in lockstep.

export const FAILED_EVENTS_KEY = "telemetry_failed_events";

/**
 * Decode a stored batch.
 *
 * The Store port never throws, and neither does this. An unavailable store, a key that
 * was never written, a half-written payload and a non-array JSON value all mean the
 * same thing to a caller — nothing replayable — so they all return `[]`. Before the
 * port, this was a bare `JSON.parse(... || "[]")` that threw straight through
 * `replayFailed()` on any corrupt payload and took startup with it.
 */
export function decodeFailed(read: StoreRead): TelemetryEvent[] {
    if (read.status !== "hit") return [];
    try {
        const parsed = JSON.parse(read.value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

/**
 * The offline store's cap (§9.4). Real numbers, not chosen ones: Android caps AsyncStorage
 * at 6 MB for the whole app and web `localStorage` is the *host app's* ~5 MB — an
 * append-only telemetry queue inside either is a slow eviction of the consumer's own data.
 */
export const STORE_MAX_EVENTS = 500;
export const STORE_MAX_BYTES = 1_000_000;

/** UTF-8 length where the runtime offers it. RN (Hermes) and every browser do; be safe anyway. */
const byteLength = (s: string): number =>
    typeof TextEncoder !== "undefined" ? new TextEncoder().encode(s).length : s.length;

/**
 * Encode the queue after appending `incoming`, oldest first, capped per §9.4 and
 * reporting how many rows the cap cost.
 *
 * The caller books the count as `sdk.drop_reason = "store_full"`; returning it rather
 * than counting in here keeps this module free of the Telemetry instance it would
 * otherwise need a handle on.
 */
export function encodeFailed(
    existing: TelemetryEvent[],
    incoming: TelemetryEvent[],
): { json: string; dropped: number } {
    const kept = [...existing, ...incoming];
    let dropped = 0;

    while (kept.length > STORE_MAX_EVENTS) { kept.splice(evictIndex(kept), 1); dropped++; }

    // Sized once per event, not once per eviction: a 500-event backlog of 100 KiB events
    // (the collector's per-event ceiling) would otherwise re-stringify ~50 MB per drop.
    // 2 for the brackets, 1 per separating comma.
    const sizes = kept.map(e => byteLength(JSON.stringify(e)));
    let total = sizes.reduce((a, b) => a + b, 0) + Math.max(kept.length - 1, 0) + 2;
    while (total > STORE_MAX_BYTES && kept.length > 0) {
        const i = evictIndex(kept);
        total -= sizes[i] + 1;
        sizes.splice(i, 1);
        kept.splice(i, 1);
        dropped++;
    }

    return { json: JSON.stringify(kept), dropped };
}
