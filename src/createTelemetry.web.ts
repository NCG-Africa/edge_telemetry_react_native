import { TelemetryWeb } from "./index.web";

export type TelemetryOpts = {
    apiKey: string;             // required; must start with "edge_"
    sender?: any;
    batchSize?: number;
    flushIntervalMs?: number;
    endpoint?: string;
    captureConsole?: boolean;   // funnel console.error/warn into app.crash (default on, opt-out)
    debug?: boolean;            // SDK-internal diagnostics; off by default (#23)
};

export function assertApiKey(apiKey?: string) {
    if (!apiKey || !apiKey.startsWith("edge_")) {
        throw new Error("createTelemetry: apiKey is required and must start with 'edge_'");
    }
}

/**
 * Cross-platform factory for telemetry. The platform is chosen by the bundler
 * via the .web / .native file split — no runtime navigator sniffing.
 */
export function createTelemetry(opts: TelemetryOpts) {
    assertApiKey(opts?.apiKey);
    return new TelemetryWeb(opts);
}
