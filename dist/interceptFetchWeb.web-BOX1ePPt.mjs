class g {
  /**
   * Create a NetworkTrackerWeb instance.
   * @param telemetry - An instance of Telemetry used for logging network events.
   */
  constructor(n) {
    this.telemetry = n;
  }
  /**
   * Starts intercepting HTTP requests made through `fetch` and `XMLHttpRequest`.
   * 
   * This method patches the global `fetch` function and `XMLHttpRequest` methods
   * `open` and `send` to gather telemetry and log it asynchronously.
   * 
   * @returns A Promise that resolves immediately once interception is setup.
   */
  start() {
    return new Promise((n) => {
      const l = this.telemetry, d = window.fetch;
      window.fetch = async (e, t) => {
        const a = Date.now();
        let r = null, o = null;
        try {
          return r = await d(e, t), r;
        } catch (s) {
          throw o = s, s;
        } finally {
          const s = Date.now(), h = typeof e == "string" ? e : e.toString();
          let u = 0;
          t?.body && typeof t.body == "string" && (u = t.body.length);
          const i = r ? Number(r.headers.get("content-length") ?? 0) : 0;
          l.log("network_request", {
            url: h,
            method: t?.method ?? "GET",
            statusCode: r?.status ?? 0,
            durationMs: s - a,
            requestBodySize: u,
            responseBodySize: i,
            error: o ? String(o) : null
          });
        }
      };
      const c = XMLHttpRequest.prototype.open, p = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(e, t, a, r, o) {
        return this._telemetry = {
          method: e,
          url: t,
          start: 0
        }, c.apply(this, arguments);
      }, XMLHttpRequest.prototype.send = function(e) {
        const t = this._telemetry;
        return t.start = Date.now(), this.addEventListener("loadend", () => {
          const r = Date.now() - t.start;
          let o = 0;
          e && typeof e == "string" && (o = e.length);
          const s = Number(this.getResponseHeader("content-length") ?? 0);
          l.log("network_request", {
            url: t.url,
            method: t.method,
            statusCode: this.status,
            durationMs: r,
            requestBodySize: o,
            responseBodySize: s,
            error: this.status === 0 ? "Network error" : null
          });
        }), p.apply(this, arguments);
      }, n();
    });
  }
}
export {
  g as NetworkTrackerWeb
};
//# sourceMappingURL=interceptFetchWeb.web-BOX1ePPt.mjs.map
