import type { StoreRead } from "../core/store";
import type { TelemetryEvent } from "../core/telemetry";

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

/** Encode the queue after appending `incoming`, oldest first. */
export function encodeFailed(existing: TelemetryEvent[], incoming: TelemetryEvent[]): string {
    // ponytail: unbounded, exactly as before the port. Capping it needs sdk.events_dropped
    // and sdk.drop_reason="store_full" on the wire, which is v4 and needs backend sign-off.
    return JSON.stringify([...existing, ...incoming]);
}
