import { Telemetry } from "../../core/telemetry";
import { NavigationTracker } from "../navigationTracker";

/**
 * Tracks navigation route changes in web environments by patching
 * history API methods and listening to popstate events.
 * Logs route transitions using an internal NavigationTracker instance.
 */
export class NavigationTrackerWeb {
    private tracker: NavigationTracker;
    private currentPath: string;

    constructor(private telemetry: Telemetry) {
        this.tracker = new NavigationTracker(telemetry);
        this.currentPath = ""; // Will be initialized on start
    }

    /**
     * Initializes tracking by patching history methods and listening
     * to popstate events. Should be called once after instantiation.
     *
     * @returns Promise<void> resolves immediately after setup
     */
    start(): Promise<void> {
        return new Promise((resolve) => {
            this.currentPath = window.location.pathname + window.location.search;
            this.patchHistory();
            this.listenPopState();
            resolve();
        });
    }

    /**
     * Patches history.pushState and history.replaceState to intercept
     * route changes and notify the NavigationTracker.
     */
    private patchHistory(): void {
        const origPush = history.pushState.bind(history);
        const origReplace = history.replaceState.bind(history);

        const handleChange = () => {
            const newPath = window.location.pathname + window.location.search;
            this.tracker.recordRouteChange(this.currentPath, newPath);
            this.currentPath = newPath;
        };

        history.pushState = (
            (data: any, unused: string, url?: string | URL | null) => {
                origPush(data, unused, url);
                handleChange();
            }
        ) as typeof history.pushState;

        history.replaceState = (
            (data: any, unused: string, url?: string | URL | null) => {
                origReplace(data, unused, url);
                handleChange();
            }
        ) as typeof history.replaceState;
    }

    /**
     * Sets up an event listener for popstate events (back/forward navigation)
     * to detect route changes triggered by browser controls.
     */
    private listenPopState(): void {
        window.addEventListener("popstate", () => {
            const newPath = window.location.pathname + window.location.search;
            this.tracker.recordRouteChange(this.currentPath, newPath);
            this.currentPath = newPath;
        });
    }
}
