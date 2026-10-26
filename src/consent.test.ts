import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TelemetryEvent } from "./core/telemetry";
import { memoryStore } from "./core/memoryStore";
import { patchXHR } from "./adapters/xhrIntercept";

// #172 — the consent kill-switch at the createTelemetry({ sender, store }) seam, both builds.
// The invariant: while disabled, the Sender receives nothing and the Store is written nothing.

vi.mock("react-native", () => ({ Dimensions: { get: () => ({ width: 390, height: 844 }) }, PixelRatio: { get: () => 3 }, Platform: { OS: "android" }, AppState: { currentState: "active", addEventListener: () => {} } }));
vi.mock("react-native-get-random-values", () => ({}));
vi.mock("react-native-device-info", () => ({ default: new Proxy({}, { get: () => async () => "x" }) }));
vi.mock("@react-native-community/netinfo", () => ({
  default: { fetch: async () => ({ type: "wifi", isConnected: true }), addEventListener: () => {} },
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

const MIN = 60 * 1000;
const settle = async () => { for (let i = 0; i < 30; i++) await vi.advanceTimersByTimeAsync(0); };

/** A minimal XHR whose prototype records what reached it. */
function fakeXHR() {
  const calls: string[] = [];
  class X {
    status = 200;
    open(m: string, u: string) { calls.push(`open ${m} ${u}`); }
    setRequestHeader(n: string, v: string) { calls.push(`header ${n}=${v}`); }
    send() { calls.push("send"); }
    addEventListener() { calls.push("listen"); }
    getResponseHeader() { return null; }
  }
  return { X: X as any, calls };
}

for (const build of ["native", "web"] as const) {
  describe(`#172 disable / enable (${build})`, () => {
    beforeEach(() => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-14T10:00:00.000Z"));
    });
    afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

    async function launch(opts: { enabled?: boolean } = {}) {
      const { createTelemetry } = build === "native" ? await import("./createTelemetry.native") : await import("./createTelemetry.web");
      const sent: TelemetryEvent[] = [];
      const store = memoryStore();
      const writes: string[] = [];
      const set = store.set.bind(store);
      const remove = store.remove.bind(store);
      (store as any).set = (k: string, v: string) => { writes.push(`set ${k}`); return set(k, v); };
      (store as any).remove = (k: string) => { writes.push(`remove ${k}`); return remove(k); };
      const t = createTelemetry({
        apiKey: "edge_consent", endpoint: "https://x/telemetry",
        sender: { send: async (e: TelemetryEvent[]) => { sent.push(...e); } },
        store: store as any, batchSize: 500, flushIntervalMs: 0,
        traceHostAllowlist: ["api.example.com"], ...opts,
      });
      const inst = await (t as any).instancePromise;
      await settle();
      return { t, inst, sent, writes, store };
    }

    it("disable() drops the queue and the stores; while off nothing is sent or written", async () => {
      const { t, inst, sent, writes, store } = await launch();
      await store.set("telemetry_failed_events", "[]");
      await t.log("custom_event", { before: true });   // queued, never flushed
      t.disable();
      expect(inst.isEnabled()).toBe(false);            // flipped synchronously
      writes.length = 0;

      await t.log("custom_event");
      await t.recordMetric("cart", 1);
      await inst.logMetric("frame_render_time", 16);   // the rAF loop's path
      t.startSpan("journey").end();
      t.markScreenReady();
      await t.addBreadcrumb("x");
      await inst.enterView("Elsewhere", "route");
      await settle();
      await t.flush();

      expect(sent).toEqual([]);
      expect(writes).toEqual([]);
      expect(store.get("telemetry_failed_events")).toMatchObject({ status: "miss" });
      expect(store.get("telemetry_session")).toMatchObject({ status: "miss" });
    });

    it("while disabled the XHR patch passes through untouched — no traceparent, no row", async () => {
      const { t, inst, sent } = await launch();
      const { X, calls } = fakeXHR();
      patchXHR(inst, X);
      t.disable();
      const x = new X();
      x.open("POST", "https://api.example.com/pay");
      x.send("{}");
      await settle();
      await t.flush();
      expect(calls).toEqual(["open POST https://api.example.com/pay", "send"]);
      expect(sent).toEqual([]);
    });

    it("enable() resumes collection and rotates a session that expired while off", async () => {
      const { t, sent } = await launch();
      t.disable();
      await vi.advanceTimersByTimeAsync(31 * MIN);
      t.enable();
      await settle();
      await t.log("custom_event", { after: true });
      await t.flush();

      const names = sent.map((e) => e.eventName);
      expect(names).toContain("session.finalized");
      expect(sent.filter((e) => e.eventName === "session.started").map((e) => e.attributes!["session.reason"]))
        .toEqual(["idle"]);   // the launch's session.started was dropped with the queue
      expect(sent.some((e) => e.attributes!.after === true)).toBe(true);
    });

    it("enabled: false starts dark; enable() announces the session and skips app.start", async () => {
      const { t, sent, writes } = await launch({ enabled: false });
      await t.log("custom_event", { dark: true });
      await t.flush();
      expect(sent).toEqual([]);
      expect(writes).toEqual([]);

      t.enable();
      await settle();
      await t.log("custom_event", { lit: true });
      await t.flush();
      const names = sent.map((e) => e.eventName);
      expect(names).toContain("session.started");
      expect(sent.find((e) => e.eventName === "session.started")!.attributes!["session.reason"]).toBe("launch");
      expect(names).not.toContain("app.start");
      expect(sent.some((e) => e.attributes!.dark === true)).toBe(false);
      expect(sent.some((e) => e.attributes!.lit === true)).toBe(true);
    });
  });
}
