// import { Telemetry } from "../core/telemetry";
// import { NavigationContainerRef, EventListenerCallback } from "@react-navigation/native";

// export class NavigationTracker {
//     private telemetry: Telemetry;
//     private routeName: string | undefined;
//     private unsubscribe?: () => void;

//     constructor(telemetry: Telemetry) {
//         this.telemetry = telemetry;
//     }

//     /**
//      * Attaches to a NavigationContainerRef so route changes are tracked automatically.
//      */
//     attach(navigationRef: NavigationContainerRef<any>) {
//         // Save initial route
//         this.routeName = navigationRef.getCurrentRoute()?.name;

//         this.unsubscribe = navigationRef.addListener("state", () => {
//             const prev = this.routeName;
//             const currentRoute = navigationRef.getCurrentRoute();
//             const current = currentRoute?.name;

//             if (prev && current && prev !== current) {
//                 this.recordRouteChange(prev, current);
//             }

//             this.routeName = current;
//         });
//     }

//     /**
//      * Stop tracking navigation.
//      */
//     detach() {
//         if (this.unsubscribe) {
//             this.unsubscribe();
//             this.unsubscribe = undefined;
//         }
//     }

//     recordRouteChange(from: string, to: string) {
//         this.telemetry.log("navigation.route_change", {
//             "navigation.from": from,
//             "navigation.to": to,
//             "navigation.timestamp": Date.now(),
//         });
//     }
// }

import { Telemetry } from "../core/telemetry";

export class NavigationTracker {
    private telemetry: Telemetry;

    constructor(telemetry: Telemetry) {
        this.telemetry = telemetry;
    }

    recordRouteChange(from: string, to: string) {
        this.telemetry.log("navigation.route_change", {
            "navigation.from": from,
            "navigation.to": to,
            "navigation.timestamp": Date.now(),
        });
    }
}
