import { Telemetry } from "../../core/telemetry";
import { NavigationTracker } from "../navigationTracker";

export class NavigationTrackerWeb {
    private tracker: NavigationTracker;
    private currentPath: string;

    constructor(telemetry: Telemetry) {
        this.tracker = new NavigationTracker(telemetry);
        this.currentPath = window.location.pathname + window.location.search;

        this.patchHistory();
        this.listenPopState();
    }

    private patchHistory() {
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

    private listenPopState() {
        window.addEventListener("popstate", () => {
            const newPath = window.location.pathname + window.location.search;
            this.tracker.recordRouteChange(this.currentPath, newPath);
            this.currentPath = newPath;
        });
    }
}
