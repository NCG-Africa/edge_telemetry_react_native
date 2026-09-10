import { TelemetryNative } from "./index.native";
import type { Store } from "./core/store";

export type TelemetryOpts = {
    apiKey: string;             // required credential; must start with "edge_" (API key or JWT, #90)
    sender?: any;
    batchSize?: number;
    flushIntervalMs?: number;
    endpoint?: string;
    captureConsole?: boolean;   // funnel console.error/warn into app.crash (default on, opt-out)
    debug?: boolean;            // SDK-internal diagnostics; off by default (#23)
    store?: Store;              // persisted-state port (#89); either shape — the native path awaits
};

// Deliberately loose: `apiKey` is the *credential*, and under AUTH_MODE=jwt it is
// `edge_<jwt>` — a shape the collector's >=3-`_`-part API-key check would reject. Tightening
// to that check here would hard-reject every JWT and make the segmented deployment
// unreachable, which is the exact bug #90 exists to close. Prefix + non-empty remainder is
// all we assert; the real catch is the 401 warn (contract §11.1).
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
