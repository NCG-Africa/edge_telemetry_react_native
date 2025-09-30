import { Telemetry } from '../../core/telemetry';
/**
 * Logs JavaScript memory usage and pressure level at regular intervals
 * in a React Native environment.
 */
export declare class TelemetryMemoryUsageNative {
    private telemetry;
    private intervalId;
    constructor(telemetry: Telemetry);
    /**
     * Records current memory usage and logs:
     * - A memory pressure event
     * - A memory usage metric
     */
    recordMemoryUsage(): void;
    /**
     * Starts periodic memory usage logging at the given interval.
     * Returns a resolved Promise for async startup flows.
     *
     * @param intervalMs Sampling interval in milliseconds (default: 30s)
     */
    start(intervalMs?: number): Promise<void>;
    /**
     * Stops the periodic memory logging if it was started.
     */
    stop(): void;
}
