import { Platform as l } from "react-native";
function i() {
  const r = global.performance;
  return r && r.memory && typeof r.memory.usedJSHeapSize == "number" ? r.memory.usedJSHeapSize / (1024 * 1024) : null;
}
class a {
  constructor(e) {
    this.telemetry = e, this.intervalId = null;
  }
  /**
   * Records current memory usage and logs:
   * - A memory pressure event
   * - A memory usage metric
   */
  recordMemoryUsage() {
    const e = i();
    if (e == null) return;
    const t = e < 256 ? "low" : e < 512 ? "moderate" : "high", m = (/* @__PURE__ */ new Date()).toISOString(), o = {
      "memory.usage_mb": e,
      "memory.pressure_level": t,
      "memory.timestamp": m
    }, s = {
      value: e,
      "metric.unit": "MB",
      "memory.type": "heap",
      "memory.source": l.OS
    };
    this.telemetry.log("memory_pressure", o), this.telemetry.log("memory_usage", s);
  }
  /**
   * Starts periodic memory usage logging at the given interval.
   * Returns a resolved Promise for async startup flows.
   * 
   * @param intervalMs Sampling interval in milliseconds (default: 30s)
   */
  start(e = 3e4) {
    return new Promise((t) => {
      this.recordMemoryUsage(), this.intervalId = setInterval(() => {
        this.recordMemoryUsage();
      }, e), t();
    });
  }
  /**
   * Stops the periodic memory logging if it was started.
   */
  stop() {
    this.intervalId !== null && (clearInterval(this.intervalId), this.intervalId = null);
  }
}
export {
  a as TelemetryMemoryUsageNative
};
//# sourceMappingURL=memoryNative.native-CRAmfjpE.mjs.map
