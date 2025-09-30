import { Telemetry } from '../../core/telemetry';
/**
 * Intercepts global `fetch` calls in React Native to log detailed telemetry data
 * about network requests, including timing, method, status, payload sizes, and errors.
 *
 * Use the `start()` method to begin interception.
 */
export declare class NetworkTrackerNative {
    private telemetry;
    private originalFetch;
    constructor(telemetry: Telemetry);
    /**
     * Starts intercepting global fetch requests.
     * Wraps `global.fetch` with telemetry logging.
     *
     * @returns Promise<void> resolves immediately after interception is set up.
     */
    start(): Promise<void>;
    /**
     * Restores the original fetch function, removing the interception.
     */
    stop(): void;
}
