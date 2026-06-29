import { TelemetryNative } from "./index.native";

export type TelemetryOpts = {
    sender?: any;
    batchSize?: number;
    flushIntervalMs?: number;
    endpoint?: string;
};

/**
 * Cross-platform factory for telemetry. The platform is chosen by the bundler
 * via the .web / .native file split — no runtime navigator sniffing.
 */
export function createTelemetry(opts?: TelemetryOpts) {
    return new TelemetryNative(opts);
}
