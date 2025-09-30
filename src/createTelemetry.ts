import { TelemetryWeb } from "./index.web";
import { TelemetryNative } from "./index.native";

type TelemetryOpts = {
    sender?: any;
    batchSize?: number;
    flushIntervalMs?: number;
    endpoint?: string;
};

/**
 * Cross-platform factory for telemetry.
 * Auto-selects web or native at runtime.
 */
export function createTelemetry(opts?: TelemetryOpts) {
    const isReactNative =
        typeof navigator !== "undefined" &&
        navigator.product === "ReactNative";

    if (isReactNative) {
        return new TelemetryNative(opts);
    }

    return new TelemetryWeb(opts);
}
