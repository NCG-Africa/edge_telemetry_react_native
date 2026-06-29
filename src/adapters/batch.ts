import type { TelemetryEvent } from "../core/telemetry";

// v3 wire envelope. Shared by both senders so the web and native POST bodies
// stay byte-identical to the EdgeRum telemetry_batch contract.
export function buildBatch(events: TelemetryEvent[]): string {
    return JSON.stringify({
        type: "telemetry_batch",
        timestamp: new Date().toISOString(),
        batch_size: events.length,
        events,
    });
}
