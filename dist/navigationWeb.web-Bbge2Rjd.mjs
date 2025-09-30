import { N as n } from "./navigationTracker-ZWsj9Z2Z.mjs";
class c {
  constructor(t) {
    this.telemetry = t, this.tracker = new n(t), this.currentPath = "";
  }
  /**
   * Initializes tracking by patching history methods and listening
   * to popstate events. Should be called once after instantiation.
   *
   * @returns Promise<void> resolves immediately after setup
   */
  start() {
    return new Promise((t) => {
      this.currentPath = window.location.pathname + window.location.search, this.patchHistory(), this.listenPopState(), t();
    });
  }
  /**
   * Patches history.pushState and history.replaceState to intercept
   * route changes and notify the NavigationTracker.
   */
  patchHistory() {
    const t = history.pushState.bind(history), i = history.replaceState.bind(history), o = () => {
      const a = window.location.pathname + window.location.search;
      this.tracker.recordRouteChange(this.currentPath, a), this.currentPath = a;
    };
    history.pushState = ((a, e, r) => {
      t(a, e, r), o();
    }), history.replaceState = ((a, e, r) => {
      i(a, e, r), o();
    });
  }
  /**
   * Sets up an event listener for popstate events (back/forward navigation)
   * to detect route changes triggered by browser controls.
   */
  listenPopState() {
    window.addEventListener("popstate", () => {
      const t = window.location.pathname + window.location.search;
      this.tracker.recordRouteChange(this.currentPath, t), this.currentPath = t;
    });
  }
}
export {
  c as NavigationTrackerWeb
};
//# sourceMappingURL=navigationWeb.web-Bbge2Rjd.mjs.map
