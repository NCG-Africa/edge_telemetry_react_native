class o {
  constructor(r) {
    this.telemetry = r;
  }
  attach() {
    return new Promise((r, n) => {
      try {
        if (console.log("CrashHandlerNative: attaching global error handlers"), typeof ErrorUtils < "u" && ErrorUtils.setGlobalHandler) {
          console.log("CrashHandlerNative: ErrorUtils available, setting global handler");
          const e = ErrorUtils.getGlobalHandler?.();
          ErrorUtils.setGlobalHandler((t, a) => {
            this.telemetry.log("app.crash", {
              message: t?.message,
              stacktrace: t?.stack,
              fatal: a
            }), e && e(t, a);
          });
        }
        const l = (e) => {
          console.log("CrashHandlerNative: unhandledrejection event caught"), this.telemetry.log("app.error", {
            message: e?.reason?.message ?? "Unhandled Promise Rejection",
            stacktrace: e?.reason?.stack
          });
        };
        globalThis.addEventListener ? (console.log("CrashHandlerNative: setting up global unhandledrejection listener"), globalThis.addEventListener("unhandledrejection", l)) : (console.log("CrashHandlerNative: addEventListener not available, using rejection-tracking"), require("promise/setimmediate/rejection-tracking").enable({
          allRejections: !0,
          onUnhandled: (t, a) => {
            this.telemetry.log("app.error", {
              message: a?.message,
              stacktrace: a?.stack
            });
          }
        }), console.log("CrashHandlerNative: rejection-tracking enabled")), r();
      } catch (l) {
        n(l);
      }
    });
  }
}
export {
  o as CrashHandlerNative
};
//# sourceMappingURL=crashHandlerNative.native-OLrR_5bs.mjs.map
