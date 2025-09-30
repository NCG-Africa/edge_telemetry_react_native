
import type { TelemetryEvent, Sender } from "../core/telemetry";
import AsyncStorage from "@react-native-async-storage/async-storage";

const DEFAULT_ENDPOINT = "https://your.telemetry.endpoint/collect";
const STORAGE_KEY = "telemetry_failed_events";

async function persistFailed(events: TelemetryEvent[]) {
    const existing = JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) || "[]");
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...existing, ...events]));
}

export function nativeSender(endpoint: string = DEFAULT_ENDPOINT): Sender {
    return {
        async send(events: TelemetryEvent[]) {
            const res = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ events }),
            });

            if (!res.ok) throw new Error(`Telemetry send failed: ${res.status}`);
        },
        async onFailure(events: TelemetryEvent[]) {
            await persistFailed(events);
        },
    };
}

// Recover failed events on app start
export async function replayFailedNative(endpoint: string = DEFAULT_ENDPOINT) {
    const stored = JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) || "[]");
    if (stored.length > 0) {
        await AsyncStorage.removeItem(STORAGE_KEY);
        return fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ events: stored }),
        });
    }
}

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
