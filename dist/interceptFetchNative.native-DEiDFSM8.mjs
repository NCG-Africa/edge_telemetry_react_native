class i {
  constructor(o) {
    this.telemetry = o, this.originalFetch = global.fetch.bind(global);
  }
  /**
   * Starts intercepting global fetch requests.
   * Wraps `global.fetch` with telemetry logging.
   *
   * @returns Promise<void> resolves immediately after interception is set up.
   */
  start() {
    return new Promise((o) => {
      global.fetch = async (r, t) => {
        const a = Date.now();
        let e = null, s = null;
        try {
          return e = await this.originalFetch(r, t), e;
        } catch (l) {
          throw s = l, l;
        } finally {
          const c = Date.now() - a, h = typeof r == "string" ? r : r.toString();
          let n = 0;
          t?.body && typeof t.body == "string" && (n = t.body.length);
          const g = e ? Number(e.headers.get("content-length") ?? 0) : 0;
          this.telemetry.log("network_request", {
            url: h,
            method: t?.method ?? "GET",
            statusCode: e?.status ?? 0,
            durationMs: c,
            requestBodySize: n,
            responseBodySize: g,
            error: s ? String(s) : null
          });
        }
      }, o();
    });
  }
  /**
   * Restores the original fetch function, removing the interception.
   */
  stop() {
    global.fetch = this.originalFetch;
  }
}
export {
  i as NetworkTrackerNative
};
//# sourceMappingURL=interceptFetchNative.native-DEiDFSM8.mjs.map
