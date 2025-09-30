import type { TelemetryEvent, Sender } from "../core/telemetry";
import AsyncStorage from "@react-native-async-storage/async-storage";

const DEFAULT_ENDPOINT = "https://your.telemetry.endpoint/collect";
const STORAGE_KEY = "telemetry_failed_events";

async function persistFailed(events: TelemetryEvent[]) {
    const existing = JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) || "[]");
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...existing, ...events]));
}

// ⬇️ Helper: send with retries (exponential backoff + jitter)
async function sendWithRetry(endpoint: string, events: TelemetryEvent[], retryCount: number = 3) {
    let attempts = 0;
    let lastError: any;

    while (attempts < retryCount) {
        try {
            const res = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ events }),
            });

            if (!res.ok) {

                console.warn("Telemetry send failed with status:", res.status);
                throw new Error(`Telemetry send failed: ${res.status}`);
            }

            console.log("Telemetry send succeeded, events sent:", events.length ?? 0);

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

export function nativeSender(endpoint: string = DEFAULT_ENDPOINT): Sender {
    return {
        async send(events) {
            try {

                console.log("Native sender sending events:", events.length ?? 0);
                await sendWithRetry(endpoint, events);
            } catch (err) {
                // Persist if final attempt fails
                console.warn("Native sender send failed after retries, persisting events:", err);
                await persistFailed(events);
                throw err;
            }
        },
        async onFailure(events) {
            await persistFailed(events);
        },
        async replayFailed() {
            console.log("Telemetry replayFailedNative launched");
            console.log("AsyncStorage available methods:", Object.keys(AsyncStorage));
            const stored = JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) || "[]");
            if (stored.length > 0) {
                console.log("Replaying failed events, count:", stored.length);
                await AsyncStorage.removeItem(STORAGE_KEY);
                console.log("Failed events removed from storage, attempting to resend");
                try {
                    await sendWithRetry(endpoint, stored);
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
export async function replayFailedNative(endpoint: string = DEFAULT_ENDPOINT) {
    console.log("Telemetry replayFailedNative launched");
    console.log("AsyncStorage available methods:", Object.keys(AsyncStorage));
    const stored = JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) || "[]");
    if (stored.length > 0) {
        await AsyncStorage.removeItem(STORAGE_KEY);
        try {
            console.log("Replaying failed events, count:", stored.length);
            console.log("Failed events removed from storage, attempting to resend");
            await sendWithRetry(endpoint, stored);
        } catch (err) {
            // If replay fails again, re-store
            console.warn("Telemetry replay failed Native Sender class:", err);
            await persistFailed(stored);
            throw err;
        }
    }
}

