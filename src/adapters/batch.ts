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

// Auth (#90, contract §11.1). The collector's credentialFromRequest reads Authorization under
// AUTH_MODE=jwt and X-API-Key otherwise — exactly one, never both. Sending both, always, with
// the same value makes one build work in the shared and the segmented (bank / on-prem)
// topologies with no mode flag. Do not sniff the credential's shape to pick a header.
export function buildHeaders(credential: string | undefined): Record<string, string> {
    return {
        "Content-Type": "application/json",
        ...(credential ? { "X-API-Key": credential, "Authorization": `Bearer ${credential}` } : {}),
    };
}

// Placeholder host — always pass a real `endpoint`. The path is the collector's real one:
// it terminates POST /telemetry (contract §11.1). Shared so the two senders cannot drift.
export const DEFAULT_ENDPOINT = "https://your.telemetry.endpoint/telemetry";
