import { debug } from "../core/debug";
import type { TelemetryEvent, Sender } from "../core/telemetry";
import type { Store } from "../core/store";
import { nativeStore } from "./native/store.native";
import { decodeFailed, encodeFailed, FAILED_EVENTS_KEY } from "./failedEvents";
import { buildBatch } from "./batch";

const DEFAULT_ENDPOINT = "https://your.telemetry.endpoint/collect";

// The offline queue goes through the Store port (#89). Unlike web, these await: on the
// native build a write is not guaranteed to have landed when the app is killed, so the
// crash-loss window narrows here rather than closing. That asymmetry is the port's point.
//
// They take the `Store` union, not `AsyncStore`. Awaiting a synchronous store is a no-op,
// so nothing breaks if a consumer injects one — the reverse is what the types must forbid,
// and webSender below is where that matters.
async function persistFailed(store: Store, events: TelemetryEvent[]) {
    const existing = decodeFailed(await store.get(FAILED_EVENTS_KEY));
    const written = await store.set(FAILED_EVENTS_KEY, encodeFailed(existing, events));
    // Storage refusing (no native module linked, full disk) is an outcome, not an error:
    // the batch is already lost, and throwing here would only lose the next one too.
    if (written.status === "unavailable") {
        debug.warn("Telemetry could not persist failed events: storage unavailable");
    }
}

// Read the queue and clear it in one step, so a replay that fails again re-persists
// rather than double-sending on the next launch.
async function takeFailed(store: Store): Promise<TelemetryEvent[]> {
    const read = await store.get(FAILED_EVENTS_KEY);
    // Clear on any hit, including a payload that decoded to nothing: a half-written queue
    // is unreplayable, and keying the removal off the decoded length would make it
    // permanent as well — re-read and re-dropped on every launch, forever.
    if (read.status === "hit") await store.remove(FAILED_EVENTS_KEY);
    return decodeFailed(read);
}

// ⬇️ Helper: send with retries (exponential backoff + jitter)
async function sendWithRetry(endpoint: string, apiKey: string | undefined, events: TelemetryEvent[], retryCount: number = 3) {
    let attempts = 0;
    let lastError: any;

    while (attempts < retryCount) {
        try {
            const res = await fetch(endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(apiKey ? { "X-API-Key": apiKey } : {}),
                },
                body: buildBatch(events),
            });

            if (!res.ok) {

                debug.warn("Telemetry send failed with status:", res.status);
                throw new Error(`Telemetry send failed: ${res.status}`);
            }

            debug.log("Telemetry send succeeded, events sent:", events.length ?? 0);

            return; // ✅ success
        } catch (err) {
            lastError = err;
            attempts++;
            if (attempts < retryCount) {
                // ⬇️ exponential backoff with jitter
                await new Promise(res =>
                    setTimeout(res, 500 * 2 ** attempts + Math.random() * 200)
                );
            }
        }
    }

    // ❌ after retries still failed
    throw lastError;
}

export function nativeSender(
    endpoint: string = DEFAULT_ENDPOINT,
    apiKey?: string,
    store: Store = nativeStore(),
): Sender {
    return {
        async send(events) {
            // Retry + backoff here; persistence on final failure is the core flush()'s
            // job via onFailure() — kept single, so a failed batch isn't persisted twice.
            await sendWithRetry(endpoint, apiKey, events);
        },
        async onFailure(events) {
            await persistFailed(store, events);
        },
        async replayFailed() {
            debug.log("Telemetry replayFailedNative launched");
            const stored = await takeFailed(store);
            if (stored.length > 0) {
                debug.log("Replaying failed events, count:", stored.length);
                try {
                    await sendWithRetry(endpoint, apiKey, stored);
                } catch (err) {
                    // If replay fails again, re-store
                    await persistFailed(store, stored);
                    throw err;
                }
            }
        },
    };
}

// Recover failed events on app start
export async function replayFailedNative(
    endpoint: string = DEFAULT_ENDPOINT,
    apiKey?: string,
    store: Store = nativeStore(),
) {
    debug.log("Telemetry replayFailedNative launched");
    const stored = await takeFailed(store);
    if (stored.length > 0) {
        try {
            debug.log("Replaying failed events, count:", stored.length);
            await sendWithRetry(endpoint, apiKey, stored);
        } catch (err) {
            // If replay fails again, re-store
            debug.warn("Telemetry replay failed Native Sender class:", err);
            await persistFailed(store, stored);
            throw err;
        }
    }
}

