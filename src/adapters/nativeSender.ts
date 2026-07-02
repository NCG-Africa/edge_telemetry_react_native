import { debug } from "../core/debug";
import type { TelemetryEvent, Sender } from "../core/telemetry";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { buildBatch } from "./batch";

const DEFAULT_ENDPOINT = "https://your.telemetry.endpoint/collect";
const STORAGE_KEY = "telemetry_failed_events";

async function persistFailed(events: TelemetryEvent[]) {
    const existing = JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) || "[]");
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...existing, ...events]));
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

export function nativeSender(endpoint: string = DEFAULT_ENDPOINT, apiKey?: string): Sender {
    return {
        async send(events) {
            // Retry + backoff here; persistence on final failure is the core flush()'s
            // job via onFailure() — kept single, so a failed batch isn't persisted twice.
            await sendWithRetry(endpoint, apiKey, events);
        },
        async onFailure(events) {
            await persistFailed(events);
        },
        async replayFailed() {
            debug.log("Telemetry replayFailedNative launched");
            debug.log("AsyncStorage available methods:", Object.keys(AsyncStorage));
            const stored = JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) || "[]");
            if (stored.length > 0) {
                debug.log("Replaying failed events, count:", stored.length);
                await AsyncStorage.removeItem(STORAGE_KEY);
                debug.log("Failed events removed from storage, attempting to resend");
                try {
                    await sendWithRetry(endpoint, apiKey, stored);
                } catch (err) {
                    // If replay fails again, re-store
                    await persistFailed(stored);
                    throw err;
                }
            }
        },
    };
}

// Recover failed events on app start
export async function replayFailedNative(endpoint: string = DEFAULT_ENDPOINT, apiKey?: string) {
    debug.log("Telemetry replayFailedNative launched");
    debug.log("AsyncStorage available methods:", Object.keys(AsyncStorage));
    const stored = JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) || "[]");
    if (stored.length > 0) {
        await AsyncStorage.removeItem(STORAGE_KEY);
        try {
            debug.log("Replaying failed events, count:", stored.length);
            debug.log("Failed events removed from storage, attempting to resend");
            await sendWithRetry(endpoint, apiKey, stored);
        } catch (err) {
            // If replay fails again, re-store
            debug.warn("Telemetry replay failed Native Sender class:", err);
            await persistFailed(stored);
            throw err;
        }
    }
}

