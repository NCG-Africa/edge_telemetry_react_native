import { TelemetryWeb } from './index.web';
import { TelemetryNative } from './index.native';
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
export declare function createTelemetry(opts?: TelemetryOpts): TelemetryWeb | TelemetryNative;
export {};
