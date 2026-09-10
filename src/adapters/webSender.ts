import { debug } from "../core/debug";
import type { TelemetryEvent, Sender } from "../core/telemetry";
import type { SyncStore } from "../core/store";
import { webStore } from "./web/store.web";
import { decodeFailed, encodeFailed, FAILED_EVENTS_KEY } from "./failedEvents";
import { buildBatch, buildHeaders, DEFAULT_ENDPOINT } from "./batch";

// The offline queue goes through the Store port (#89), and on web it stays SYNCHRONOUS
// on purpose. onFailure() runs on the unload path; a synchronous set() has landed before
// the function returns, which is what closes the crash-loss window here rather than
// merely narrowing it. Do not make these helpers async.
// Returns how many rows the §9.4 cap evicted, for core's `sdk.events_dropped`.
function persistFailed(store: SyncStore, events: TelemetryEvent[]): number {
    const existing = decodeFailed(store.get(FAILED_EVENTS_KEY));
    const { json, dropped } = encodeFailed(existing, events);
    const written = store.set(FAILED_EVENTS_KEY, json);
    // Storage refusing (incognito, quota, partitioned iframe) is an outcome, not an error:
    // the batch is already lost, and throwing here would only lose the next one too.
    if (written.status === "unavailable") {
        debug.warn("Telemetry could not persist failed events: storage unavailable");
    }
    return dropped;
}

// Read the queue and clear it in one step, so a replay that fails again re-persists
// rather than double-sending on the next launch.
function takeFailed(store: SyncStore): TelemetryEvent[] {
    const read = store.get(FAILED_EVENTS_KEY);
    // Clear on any hit, including a payload that decoded to nothing: a half-written queue
    // is unreplayable, and keying the removal off the decoded length would make it
    // permanent as well — re-read and re-dropped on every launch, forever.
    if (read.status === "hit") store.remove(FAILED_EVENTS_KEY);
    return decodeFailed(read);
}

// Try sending a batch with retries + backoff.
// v3 uses fetch({ keepalive: true }) rather than navigator.sendBeacon: the beacon
// API cannot set the required credential headers. keepalive preserves the
// survives-page-unload property we relied on sendBeacon for.
async function sendWithRetry(endpoint: string, apiKey: string | undefined, events: TelemetryEvent[], retryCount: number = 3) {
    let attempts = 0;
    let lastError: any;

    while (attempts < retryCount) {
        try {
            const res = await fetch(endpoint, {
                method: "POST",
                headers: buildHeaders(apiKey),
                body: buildBatch(events),
                keepalive: true,
            });

            if (!res.ok) {
                throw new Error(`Telemetry send failed: ${res.status}`);
            }

            return; // ✅ success
        } catch (err) {
            lastError = err;
            attempts++;
            if (attempts < retryCount) {
                await new Promise(res => setTimeout(res, attempts * 500)); // backoff
            }
        }
    }

    // ❌ after retries still failed
    throw lastError;
}

export function webSender(
    endpoint: string = DEFAULT_ENDPOINT,
    apiKey?: string,
    store: SyncStore = webStore(),
    retryCount: number = 3,
): Sender {
    return {
        async send(events: TelemetryEvent[]) {
            // Retry + backoff here; persistence on final failure is the core flush()'s
            // job via onFailure() — kept single, so a failed batch isn't persisted twice.
            await sendWithRetry(endpoint, apiKey, events, retryCount);
        },
        async onFailure(events: TelemetryEvent[]) {
            return persistFailed(store, events);
        },
    };
}

// Replay failed events on startup
export function replayFailedWeb(
    endpoint: string = DEFAULT_ENDPOINT,
    apiKey?: string,
    store: SyncStore = webStore(),
    retryCount: number = 3,
) {
    debug.log("Telemetry replayFailedWeb launched");
    const stored = takeFailed(store);
    if (stored.length > 0) {
        return sendWithRetry(endpoint, apiKey, stored, retryCount).catch(err => {
            // If replay fails again, re-persist
            persistFailed(store, stored);
            debug.warn("Telemetry replay failed:", err);
        });
    }
}

