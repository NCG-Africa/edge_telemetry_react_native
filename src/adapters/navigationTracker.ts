import { Telemetry } from "../core/telemetry";

export class NavigationTracker {
    private telemetry: Telemetry;

    constructor(telemetry: Telemetry) {
        this.telemetry = telemetry;
    }

    recordRouteChange(from: string, to: string) {
        console.log(`Navigation from ${from} to ${to}`);
        this.telemetry.log("navigation.route_change", {
            "navigation.from": from,
            "navigation.to": to,
            "navigation.timestamp": Date.now(),
        });
    }
}
