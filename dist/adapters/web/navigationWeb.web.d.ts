import { Telemetry } from '../../core/telemetry';
/**
 * Tracks navigation route changes in web environments by patching
 * history API methods and listening to popstate events.
 * Logs route transitions using an internal NavigationTracker instance.
 */
export declare class NavigationTrackerWeb {
    private telemetry;
    private tracker;
    private currentPath;
    constructor(telemetry: Telemetry);
    /**
     * Initializes tracking by patching history methods and listening
     * to popstate events. Should be called once after instantiation.
     *
     * @returns Promise<void> resolves immediately after setup
     */
    start(): Promise<void>;
    /**
     * Patches history.pushState and history.replaceState to intercept
     * route changes and notify the NavigationTracker.
     */
    private patchHistory;
    /**
     * Sets up an event listener for popstate events (back/forward navigation)
     * to detect route changes triggered by browser controls.
     */
    private listenPopState;
}
