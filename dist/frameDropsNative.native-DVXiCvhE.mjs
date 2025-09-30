class o {
  constructor(s, e = 60) {
    this.telemetry = s, this.lastFrameTime = performance.now(), this.targetFPS = e, this.frameBudget = 1e3 / this.targetFPS;
  }
  /**
   * Starts tracking frame drops.
   * Returns a resolved Promise for compatibility with async startup flows.
   */
  start() {
    return new Promise((s) => {
      const e = () => {
        const a = performance.now(), t = a - this.lastFrameTime;
        if (this.lastFrameTime = a, t > this.frameBudget * 2) {
          let r;
          t > this.frameBudget * 3 ? r = "high" : t > this.frameBudget * 2 ? r = "medium" : r = "low";
          const i = {
            "frame.delta_ms": t,
            "frame.target_fps": this.targetFPS,
            "frame.severity": r
          };
          this.telemetry.log("frame_drop", i);
        }
        requestAnimationFrame(e);
      };
      requestAnimationFrame(e), s();
    });
  }
}
export {
  o as FrameDropTrackerNative
};
//# sourceMappingURL=frameDropsNative.native-DVXiCvhE.mjs.map
