import type { TelemetryEvent, Sender } from "../core/telemetry";

const DEFAULT_ENDPOINT = "https://your.telemetry.endpoint/collect";

// Utility to persist failed events
function persistFailed(events: TelemetryEvent[]) {
    const key = "telemetry_failed_events";
    const existing = JSON.parse(localStorage.getItem(key) || "[]");
    localStorage.setItem(key, JSON.stringify([...existing, ...events]));
}

export function webSender(endpoint: string = DEFAULT_ENDPOINT): Sender {
    return {
        async send(events: TelemetryEvent[]) {
            const payload = JSON.stringify({ events });

            if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
                const blob = new Blob([payload], { type: "application/json" });
                if (!navigator.sendBeacon(endpoint, blob)) {
                    throw new Error("sendBeacon failed");
                }
                return;
            }

            const res = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: payload,
            });

            if (!res.ok) throw new Error(`Telemetry send failed: ${res.status}`);
        },
        async onFailure(events: TelemetryEvent[]) {
            persistFailed(events);
        },
    };
}

// Recover failed events on page load
export function replayFailedWeb(endpoint: string = DEFAULT_ENDPOINT) {
    const key = "telemetry_failed_events";
    const stored = JSON.parse(localStorage.getItem(key) || "[]");
    if (stored.length > 0) {
        localStorage.removeItem(key);
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
// export function webSender(endpoint: string = DEFAULT_ENDPOINT): Sender {
//     return {
//         async send(_endpoint: string, events: TelemetryEvent[]) {
//             const payload = JSON.stringify({ events });

//             if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
//                 const blob = new Blob([payload], { type: "application/json" });
//                 navigator.sendBeacon(endpoint, blob);
//                 return;
//             }

//             // fallback to fetch
//             await fetch(endpoint, {
//                 method: "POST",
//                 headers: { "Content-Type": "application/json" },
//                 body: payload,
//             });
//         },
//     };
// }
