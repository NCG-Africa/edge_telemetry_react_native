import { Telemetry } from '../../core/telemetry';
/**
 * NetworkTrackerWeb intercepts all HTTP requests made through
 * `window.fetch` and `XMLHttpRequest` in a browser environment.
 *
 * It logs detailed telemetry data such as request URL, HTTP method,
 * response status, request and response body sizes, request duration,
 * and error information, if any.
 *
 * This class should be instantiated once and the `start` method called
 * during application initialization to begin interception.
 */
export declare class NetworkTrackerWeb {
    private telemetry;
    /**
     * Create a NetworkTrackerWeb instance.
     * @param telemetry - An instance of Telemetry used for logging network events.
     */
    constructor(telemetry: Telemetry);
    /**
     * Starts intercepting HTTP requests made through `fetch` and `XMLHttpRequest`.
     *
     * This method patches the global `fetch` function and `XMLHttpRequest` methods
     * `open` and `send` to gather telemetry and log it asynchronously.
     *
     * @returns A Promise that resolves immediately once interception is setup.
     */
    start(): Promise<void>;
}
