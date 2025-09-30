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
                throw new Error(`Telemetry send failed: ${res.status}`);
            }

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
                await sendWithRetry(endpoint, events);
            } catch (err) {
                // Persist if final attempt fails
                await persistFailed(events);
                throw err;
            }
        },
        async onFailure(events) {
            await persistFailed(events);
        },
        async replayFailed() {
            const stored = JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) || "[]");
            if (stored.length > 0) {
                await AsyncStorage.removeItem(STORAGE_KEY);
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
    const stored = JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) || "[]");
    if (stored.length > 0) {
        await AsyncStorage.removeItem(STORAGE_KEY);
        try {
            await sendWithRetry(endpoint, stored);
        } catch (err) {
            // If replay fails again, re-store
            await persistFailed(stored);
            throw err;
        }
    }
}

// import type { TelemetryEvent, Sender } from "../core/telemetry";
// import AsyncStorage from "@react-native-async-storage/async-storage";

// const DEFAULT_ENDPOINT = "https://your.telemetry.endpoint/collect";
// const STORAGE_KEY = "telemetry_failed_events";

// async function persistFailed(events: TelemetryEvent[]) {
//     const existing = JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) || "[]");
//     await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...existing, ...events]));
// }

// export function nativeSender(endpoint: string = DEFAULT_ENDPOINT): Sender {
//     return {
//         async send(events) {
//             const res = await fetch(endpoint, {
//                 method: "POST",
//                 headers: { "Content-Type": "application/json" },
//                 body: JSON.stringify({ events }),
//             });
//             if (!res.ok) throw new Error(`Telemetry send failed: ${res.status}`);
//         },
//         async onFailure(events) {
//             const existing = JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) || "[]");
//             await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...existing, ...events]));
//         },
//         async replayFailed() {
//             const stored = JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) || "[]");
//             if (stored.length > 0) {
//                 await AsyncStorage.removeItem(STORAGE_KEY);
//                 await fetch(endpoint, {
//                     method: "POST",
//                     headers: { "Content-Type": "application/json" },
//                     body: JSON.stringify({ events: stored }),
//                 });
//             }
//         },
//     };
// }


// // Recover failed events on app start
// export async function replayFailedNative(endpoint: string = DEFAULT_ENDPOINT) {
//     const stored = JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) || "[]");
//     if (stored.length > 0) {
//         await AsyncStorage.removeItem(STORAGE_KEY);
//         return fetch(endpoint, {
//             method: "POST",
//             headers: { "Content-Type": "application/json" },
//             body: JSON.stringify({ events: stored }),
//         });
//     }
// }

// import type { TelemetryEvent, Sender } from "../core/telemetry";

// // Default endpoint
// const DEFAULT_ENDPOINT = "https://your.telemetry.endpoint/collect";

// // Factory to create a sender with a configurable endpoint
// export function nativeSender(endpoint: string = DEFAULT_ENDPOINT): Sender {
//     return {
//         async send(_endpoint: string, events: TelemetryEvent[]) {
//             const payload = JSON.stringify({ events });

//             try {
//                 await fetch(endpoint, {
//                     method: "POST",
//                     headers: { "Content-Type": "application/json" },
//                     body: payload,
//                 });
//             } catch (err) {
//                 // TODO: optionally persist to AsyncStorage on failure
//                 console.error("Telemetry send failed:", err);
//             }
//         },
//     };
// }


// import type { TelemetryEvent, Sender } from "../core/telemetry";
// // Note: do NOT import AsyncStorage at top-level if you want to avoid problems when bundling for web.
// // If you use it here, consumers must have AsyncStorage installed.
// const ENDPOINT = "https://your.telemetry.endpoint/collect";

// export const nativeSender: Sender = {
//     async send(events: TelemetryEvent[]) {
//         const payload = JSON.stringify({ events });
//         // In React Native, fetch is available
//         await fetch(ENDPOINT, {
//             method: "POST",
//             headers: { "Content-Type": "application/json" },
//             body: payload
//         });
//         // Optional: persist to AsyncStorage on failure — implement in later step
//     }
// };
