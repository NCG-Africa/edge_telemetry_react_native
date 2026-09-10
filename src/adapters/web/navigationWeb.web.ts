import { Telemetry } from "../../core/telemetry";
import { NavigationTracker } from "../navigationTracker";
import { normalizeRoute } from "../httpAttributes";

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

        const handleChange = () => this.handleChange();

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
        window.addEventListener("popstate", () => this.handleChange());
    }

    /**
     * One route change: the existing `navigation` row, then rung 3 of the name ladder
     * (§4.5.1) — the *last* rung, so an `attachNavigation` consumer's `route.name` outranks
     * it whichever arrives first.
     *
     * Normalized by §4.4.1's rule, and the query string is dropped: there is no `view.url`
     * and no raw path on the wire, because the identifier lives in the path
     * (`/accounts/GB29-NWBK-…`) and query-stripping alone would not have addressed that.
     */
    private handleChange(): void {
        const newPath = window.location.pathname + window.location.search;
        const from = this.currentPath;
        this.currentPath = newPath;
        void Promise.resolve(this.tracker.recordRouteChange(from, newPath))
            .then(() => this.telemetry.enterView(normalizeRoute(window.location.pathname), "url"));
    }
}
