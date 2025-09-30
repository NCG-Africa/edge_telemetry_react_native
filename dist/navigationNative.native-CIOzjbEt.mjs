import { N as r } from "./navigationTracker-ZWsj9Z2Z.mjs";
class n {
  constructor(t) {
    this.tracker = new r(t);
  }
  attach(t) {
    t && (console.log("NavigationTrackerNative: attaching to navigationRef"), t.addListener("state", () => {
      const e = this.getActiveRouteName(t.getCurrentRoute());
      e && e !== this.currentRoute && (console.log(`NavigationTrackerNative: route changed to ${e}`), this.tracker.recordRouteChange(this.currentRoute ?? "init", e), this.currentRoute = e);
    }));
  }
  getActiveRouteName(t) {
    if (!t) return "unknown";
    if (t.state) {
      const e = t.state.routes[t.state.index];
      return this.getActiveRouteName(e);
    }
    return t.name;
  }
}
export {
  n as NavigationTrackerNative
};
//# sourceMappingURL=navigationNative.native-CIOzjbEt.mjs.map
