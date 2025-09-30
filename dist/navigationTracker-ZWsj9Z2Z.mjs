class e {
  constructor(t) {
    this.telemetry = t;
  }
  recordRouteChange(t, a) {
    console.log(`Navigation from ${t} to ${a}`), this.telemetry.log("navigation.route_change", {
      "navigation.from": t,
      "navigation.to": a,
      "navigation.timestamp": Date.now()
    });
  }
}
export {
  e as N
};
//# sourceMappingURL=navigationTracker-ZWsj9Z2Z.mjs.map
