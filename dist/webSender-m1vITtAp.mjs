const d = "https://your.telemetry.endpoint/collect", s = "telemetry_failed_events";
function c(t) {
  const o = JSON.parse(localStorage.getItem(s) || "[]");
  localStorage.setItem(s, JSON.stringify([...o, ...t]));
}
async function f(t, o, e = 3) {
  let n = 0, i;
  for (; n < e; )
    try {
      const r = JSON.stringify({ events: o });
      if (typeof navigator < "u" && typeof navigator.sendBeacon == "function") {
        const l = new Blob([r], { type: "application/json" });
        if (!navigator.sendBeacon(t, l))
          throw new Error("sendBeacon failed");
        return;
      }
      const a = await fetch(t, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: r
      });
      if (!a.ok)
        throw new Error(`Telemetry send failed: ${a.status}`);
      return;
    } catch (r) {
      i = r, n++, n < e && await new Promise((a) => setTimeout(a, n * 500));
    }
  throw i;
}
function y(t = d, o = 3) {
  return {
    async send(e) {
      try {
        await f(t, e, o);
      } catch (n) {
        throw c(e), n;
      }
    },
    async onFailure(e) {
      c(e);
    }
  };
}
export {
  y as webSender
};
//# sourceMappingURL=webSender-m1vITtAp.mjs.map
