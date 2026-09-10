import { debug } from "../core/debug";
import { Telemetry } from "../core/telemetry";

/**
 * React Navigation route tracking, **shared by both builds** (§4.5.1, #96).
 *
 * `getCurrentRoute()` is a navigation-tree API, not a native one — it works identically on
 * RN-Web — and `route.name` is rung 2 of the name ladder. Wiring it once means one
 * `GROUP BY view.name` spans web and native, instead of web reverse-engineering a template
 * out of a URL the app is already holding in memory.
 *
 * Everything platform-specific stays in `Telemetry.recordRouteChange`, which gates the two
 * deprecated native feeds (§4.11) on an entry-supplied flag.
 *
 * Usage: pass your navigationContainerRef.
 */
export class NavigationRefTracker {
    private currentRoute?: string;

    constructor(private telemetry: Telemetry) {}

    attach(navigationRef: any) {
        if (!navigationRef) return;

        debug.log("NavigationRefTracker: attaching to navigationRef");
        navigationRef.addListener("state", () => {
            const route = this.getActiveRouteName(navigationRef.getCurrentRoute());
            if (route && route !== this.currentRoute) {

                debug.log(`NavigationRefTracker: route changed to ${route}`);
                const from = this.currentRoute ?? "init";
                this.currentRoute = route;
                this.telemetry.recordRouteChange(from, route)
                    .catch((err) => debug.warn("NavigationRefTracker: route change failed:", err));
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
