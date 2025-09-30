import { Telemetry } from '../../core/telemetry';
/**
 * Logs JavaScript heap memory usage and pressure level at regular intervals
 * in browser environments using the Performance API.
 */
export declare class TelemetryMemoryUsageWeb {
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
     * Starts periodic memory usage logging at the specified interval.
     * Returns a Promise that resolves immediately for async compatibility.
     *
     * @param intervalMs Interval in milliseconds between samples (default 30s)
     * @returns Promise<void>
     */
    start(intervalMs?: number): Promise<void>;
    /**
     * Stops the periodic memory logging if running.
     */
    stop(): void;
}
