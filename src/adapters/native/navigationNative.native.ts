import { Telemetry } from "../../core/telemetry";
import { NavigationTracker } from "../navigationTracker";

/**
 * Hook into React Navigation events
 * Usage: pass your navigationContainerRef
 */
export class NavigationTrackerNative {
    private tracker: NavigationTracker;
    private currentRoute?: string;

    constructor(telemetry: Telemetry) {
        this.tracker = new NavigationTracker(telemetry);
    }

    attach(navigationRef: any) {
        if (!navigationRef) return;

        console.log("NavigationTrackerNative: attaching to navigationRef");
        navigationRef.addListener("state", () => {
            const route = this.getActiveRouteName(navigationRef.getCurrentRoute());
            if (route && route !== this.currentRoute) {

                console.log(`NavigationTrackerNative: route changed to ${route}`);
                this.tracker.recordRouteChange(this.currentRoute ?? "init", route);
                this.currentRoute = route;
            }
        });
    }

    private getActiveRouteName(route: any): string {
        if (!route) return "unknown";
        if (route.state) {
            const nested = route.state.routes[route.state.index];
            return this.getActiveRouteName(nested);
        }
        return route.name;
    }
}
