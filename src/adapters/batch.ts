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

// v4 auth (#90, contract §11.1). `apiKey` is *the credential*, not necessarily an API key:
// the collector's credentialFromRequest reads Authorization under AUTH_MODE=jwt and
// X-API-Key otherwise — exactly one, never both. Sending both, always, with the same
// value makes one build work in the shared and segmented (bank / on-prem) topologies with
// no mode flag and no shape sniffing. Do not sniff the credential shape to pick a header.
export function buildHeaders(apiKey: string | undefined): Record<string, string> {
    return {
        "Content-Type": "application/json",
        ...(apiKey ? { "X-API-Key": apiKey, "Authorization": `Bearer ${apiKey}` } : {}),
    };
}
