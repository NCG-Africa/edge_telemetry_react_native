function n() {
  const r = performance;
  return r && r.memory && typeof r.memory.usedJSHeapSize == "number" ? r.memory.usedJSHeapSize / (1024 * 1024) : null;
}
class i {
  constructor(e) {
    this.telemetry = e, this.intervalId = null;
  }
  /**
   * Records current memory usage and logs:
   * - A memory pressure event
   * - A memory usage metric
   */
  recordMemoryUsage() {
    const e = n();
    if (e == null) return;
    const t = e < 256 ? "low" : e < 512 ? "moderate" : "high", m = (/* @__PURE__ */ new Date()).toISOString(), s = {
      "memory.usage_mb": e,
      "memory.pressure_level": t,
      "memory.timestamp": m
    }, o = {
      value: e,
      "metric.unit": "MB",
      "memory.type": "heap",
      "memory.source": "performance.memory"
    };
    this.telemetry.log("memory_pressure", s), this.telemetry.log("memory_usage", o);
  }
  /**
   * Starts periodic memory usage logging at the specified interval.
   * Returns a Promise that resolves immediately for async compatibility.
   *
   * @param intervalMs Interval in milliseconds between samples (default 30s)
   * @returns Promise<void>
   */
  start(e = 3e4) {
    return new Promise((t) => {
      this.recordMemoryUsage(), this.intervalId = window.setInterval(() => {
        this.recordMemoryUsage();
      }, e), t();
    });
  }
  /**
   * Stops the periodic memory logging if running.
   */
  stop() {
    this.intervalId !== null && (clearInterval(this.intervalId), this.intervalId = null);
  }
}
export {
  i as TelemetryMemoryUsageWeb
};
//# sourceMappingURL=memoryWeb.web-Xl2GvVXm.mjs.map
