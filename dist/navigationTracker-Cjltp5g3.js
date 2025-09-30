"use strict";class o{constructor(t){this.telemetry=t}recordRouteChange(t,a){console.log(`Navigation from ${t} to ${a}`),this.telemetry.log("navigation.route_change",{"navigation.from":t,"navigation.to":a,"navigation.timestamp":Date.now()})}}exports.NavigationTracker=o;
//# sourceMappingURL=navigationTracker-Cjltp5g3.js.map
