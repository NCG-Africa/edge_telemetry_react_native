import { Telemetry } from "../core/telemetry";

export class NavigationTracker {
    private telemetry: Telemetry;

    constructor(telemetry: Telemetry) {
        this.telemetry = telemetry;
    }

    // Route change → v3 `navigation`. Baseline keys follow the reference/Angular shape;
    // iOS (screen/previous_screen/type/kind) reconciliation is OPEN (see additions ledger).
    recordRouteChange(from: string, to: string) {
        this.telemetry.log("navigation", {
            "navigation.from_screen": from,
            "navigation.to_screen": to,
            "navigation.method": "push",
            "navigation.route_type": "screen",
        });
    }
}
