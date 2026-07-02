import { debug } from "../core/debug";
import type { TelemetryEvent, Sender } from "../core/telemetry";
import { buildBatch } from "./batch";

const DEFAULT_ENDPOINT = "https://your.telemetry.endpoint/collect";
const STORAGE_KEY = "telemetry_failed_events";

// Save failed events in localStorage
function persistFailed(events: TelemetryEvent[]) {
    if (typeof localStorage === "undefined") return;
    const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...existing, ...events]));
}

// Try sending a batch with retries + backoff.
// v3 uses fetch({ keepalive: true }) rather than navigator.sendBeacon: the beacon
// API cannot set the required X-API-Key header. keepalive preserves the
// survives-page-unload property we relied on sendBeacon for.
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

export function webSender(endpoint: string = DEFAULT_ENDPOINT, apiKey?: string, retryCount: number = 3): Sender {
    return {
        async send(events: TelemetryEvent[]) {
            // Retry + backoff here; persistence on final failure is the core flush()'s
            // job via onFailure() — kept single, so a failed batch isn't persisted twice.
            await sendWithRetry(endpoint, apiKey, events, retryCount);
        },
        async onFailure(events: TelemetryEvent[]) {
            persistFailed(events);
        },
    };
}

// Replay failed events on startup
export function replayFailedWeb(endpoint: string = DEFAULT_ENDPOINT, apiKey?: string, retryCount: number = 3) {
    debug.log("Telemetry replayFailedWeb launched");
    if (typeof localStorage === "undefined") return;
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as TelemetryEvent[];
    if (stored.length > 0) {
        localStorage.removeItem(STORAGE_KEY);
        return sendWithRetry(endpoint, apiKey, stored, retryCount).catch(err => {
            // If replay fails again, re-persist
            persistFailed(stored);
            debug.warn("Telemetry replay failed:", err);
        });
    }
}

