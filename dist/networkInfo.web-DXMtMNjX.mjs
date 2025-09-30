async function e() {
  return typeof navigator < "u" && "connection" in navigator ? {
    type: navigator.connection.type || "unknown",
    isConnected: navigator.onLine
    // downlink: conn.downlink,
    // effectiveType: conn.effectiveType,
  } : {
    type: "unknown",
    isConnected: typeof navigator < "u" ? navigator.onLine : void 0
  };
}
class r {
  // constructor(private telemetry: Telemetry) { }
  constructor() {
  }
  async collect() {
    return e();
  }
  async start(o) {
    this.telemetry = o;
    const n = await this.collect();
    return this.telemetry.log("network_info", n), n;
  }
}
export {
  r as NetworkInfoTrackerWeb,
  e as getNetworkInfo
};
//# sourceMappingURL=networkInfo.web-DXMtMNjX.mjs.map
