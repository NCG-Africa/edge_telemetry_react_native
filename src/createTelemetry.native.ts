import { TelemetryNative } from "./index.native";
import type { Store } from "./core/store";

export type TelemetryOpts = {
    apiKey: string;             // required; must start with "edge_"
    sender?: any;
    batchSize?: number;
    flushIntervalMs?: number;
    endpoint?: string;
    captureConsole?: boolean;   // funnel console.error/warn into app.crash (default on, opt-out)
    debug?: boolean;            // SDK-internal diagnostics; off by default (#23)
    store?: Store;              // persisted-state port (#89); defaults per build
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
    return new TelemetryNative(opts);
}
