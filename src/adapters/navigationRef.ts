import { debug } from "../core/debug";
import { Telemetry } from "../core/telemetry";

/**
 * React Navigation route tracking, **shared by both builds** (§4.5.1, #96).
 *
 * The navigation tree is a JS API, not a native one — it works identically on RN-Web — so
 * wiring it once means one `GROUP BY view.name` spans web and native.
 *
 * `view.name` is the focused route names **joined root to leaf with `/`** (#170): nested
 * screens sharing a leaf name (`HomeTab/Details`, `SearchTab/Details`) stay distinguishable,
 * and under Expo Router the route names *are* the file-path template, so the join yields
 * `(tabs)/settings/index` with no Expo dependency and no Expo API. Rung 2: **never
 * normalized**, and route **params are never read** — the template is the name, the value
 * is not.
 *
 * Usage: pass your navigation container ref — under Expo Router,
 * `attachNavigation(useNavigationContainerRef())` in the root `_layout`.
 */
export class NavigationRefTracker {
    private currentRoute?: string;

    constructor(private telemetry: Pick<Telemetry, "recordRouteChange">) {}

    attach(navigationRef: any) {
        if (!navigationRef) return;

        debug.log("NavigationRefTracker: attaching to navigationRef");
        const read = () => this.onRoute(routePath(navigationRef));
        navigationRef.addListener("state", read);
        // The first screen never fires `state` — it is the initial state. Read it now when the
        // container is ready, and otherwise once on the ref's own `ready` event.
        if (navigationRef.isReady?.()) read();
        else navigationRef.addListener("ready", read);
    }

    private onRoute(route: string) {
        if (route === this.currentRoute) return;
        debug.log(`NavigationRefTracker: route changed to ${route}`);
        this.currentRoute = route;
        this.telemetry.recordRouteChange(route)
            .catch((err) => debug.warn("NavigationRefTracker: route change failed:", err));
    }
}

/**
 * The focused route's name path, root to leaf. Reads `getRootState()` — `getCurrentRoute()`
 * returns only the leaf — and falls back to the leaf's name on a ref that lacks it.
 */
export function routePath(navigationRef: any): string {
    const names: string[] = [];
    let state = navigationRef.getRootState?.();
    while (state?.routes?.length) {
        const route = state.routes[state.index ?? state.routes.length - 1];
        if (!route) break;
        names.push(route.name);
        state = route.state;
    }
    if (names.length) return names.join("/");
    return navigationRef.getCurrentRoute?.()?.name ?? "unknown";
}
