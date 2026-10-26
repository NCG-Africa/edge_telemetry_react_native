import { Telemetry } from "../../core/telemetry";
import { debug } from "../../core/debug";
import { normalizeRoute } from "../httpAttributes";

/**
 * Tracks route changes in web environments by patching the history API methods and listening
 * to popstate events, feeding rung 3 (`url`) of the view-name ladder. Emits no `navigation`
 * row: that feed is removed in v5 (#163), which also closes its raw query-string leak.
 */
export class NavigationTrackerWeb {
    constructor(private telemetry: Telemetry) { }

    /**
     * Initializes tracking by patching history methods and listening
     * to popstate events. Should be called once after instantiation.
     *
     * @returns Promise<void> resolves immediately after setup
     */
    start(): Promise<void> {
        return new Promise((resolve) => {
            this.patchHistory();
            this.listenPopState();
            resolve();
        });
    }

    /**
     * Patches history.pushState and history.replaceState to intercept route changes.
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
     * One route change: rung 3 of the name ladder (§4.5.1) — the *last* rung, so an
     * `attachNavigation` consumer's `route.name` outranks it whichever arrives first.
     *
     * Normalized by §4.4.1's rule, and the query string is dropped: there is no `view.url`
     * and no raw path on the wire, because the identifier lives in the path
     * (`/accounts/GB29-NWBK-…`) and query-stripping alone would not have addressed that.
     */
    private handleChange(): void {
        this.telemetry.enterView(normalizeRoute(window.location.pathname), "url")
            .catch((err) => debug.warn("NavigationTrackerWeb: route change failed:", err));
    }
}
