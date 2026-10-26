import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TelemetryEvent } from "./core/telemetry";
import { memoryStore } from "./core/memoryStore";

// #167 — recordMetric, addBreadcrumb, startNewSession at the createTelemetry seam, both builds.

vi.mock("react-native", () => ({ Dimensions: { get: () => ({ width: 390, height: 844 }) }, PixelRatio: { get: () => 3 }, Platform: { OS: "android" }, AppState: { currentState: "active", addEventListener: () => {} } }));
vi.mock("react-native-get-random-values", () => ({}));
vi.mock("react-native-device-info", () => ({ default: new Proxy({}, { get: () => async () => "x" }) }));
vi.mock("@react-native-community/netinfo", () => ({
  default: { fetch: async () => ({ type: "wifi", isConnected: true }), addEventListener: () => {} },
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

for (const build of ["native", "web"] as const) {
  describe(`#167 parity APIs (${build})`, () => {
    beforeEach(() => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(console, "warn").mockImplementation(() => {});
    });
    afterEach(() => vi.restoreAllMocks());

    async function launch() {
      const { createTelemetry } = build === "native" ? await import("./createTelemetry.native") : await import("./createTelemetry.web");
      const sent: TelemetryEvent[] = [];
      const t = createTelemetry({
        apiKey: "edge_parity", endpoint: "https://x/telemetry",
        sender: { send: async (e: TelemetryEvent[]) => { sent.push(...e); } },
        store: memoryStore() as any, batchSize: 500, flushIntervalMs: 0,
      });
      const inst = await (t as any).instancePromise;
      return { t, inst, sent };
    }

    it("recordMetric: unit → metric.unit; reserved names and non-finite values are dropped", async () => {
      const { t, sent } = await launch();
      await t.recordMetric("cart_items", 3, { "metric.unit": "forged", store: "nairobi" }, { unit: "count" });
      await t.recordMetric("checkout_ms", 120);
      for (const reserved of ["frame_render_time", "memory_usage", "LCP", "FCP", "CLS", "INP", "TTFB"]) {
        await t.recordMetric(reserved, 1, undefined, { unit: "bogus" });
      }
      await t.recordMetric("bad", NaN);
      await t.recordMetric("bad", Infinity);
      await t.flush();

      const metrics = sent.filter((e) => e.type === "metric");
      expect(metrics.map((m) => m.metricName)).toEqual(["cart_items", "checkout_ms"]);
      expect(metrics[0]).toMatchObject({ value: 3, attributes: { "metric.unit": "count", store: "nairobi" } });
      expect(metrics[1].attributes).not.toHaveProperty("metric.unit");
    });

    it("addBreadcrumb lands, bounded, on the next app.crash", async () => {
      const { t, inst, sent } = await launch();
      await t.addBreadcrumb("tapped_pay", { amount: 42, nested: { a: 1 } });
      await inst.log("app.crash", { "error.message": "x" });   // the SDK's own crash path
      await t.flush();
      const crash = sent.find((e) => e.eventName === "app.crash")!;
      const crumbs = JSON.parse(crash.attributes!["error.breadcrumbs"]);
      expect(crumbs).toContainEqual(expect.objectContaining({ name: "tapped_pay", amount: 42, nested: '{"a":1}' }));
    });

    it("startNewSession rotates with session.reason: manual on both events", async () => {
      const { t, sent } = await launch();
      await t.log("custom_event");
      await t.startNewSession();
      await t.log("custom_event");
      await t.flush();

      const finalized = sent.filter((e) => e.eventName === "session.finalized");
      const started = sent.filter((e) => e.eventName === "session.started");
      expect(finalized.map((e) => e.attributes!["session.reason"])).toEqual(["manual"]);
      expect(started.map((e) => e.attributes!["session.reason"])).toEqual(["launch", "manual"]);
      expect(started[1].attributes!["session.id"]).not.toBe(started[0].attributes!["session.id"]);
      const last = sent.filter((e) => e.eventName === "custom_event").slice(-1)[0];
      expect(last.attributes!["session.id"]).toBe(started[1].attributes!["session.id"]);
      // the departing view is emitted under the old session, as with any rotation
      const view = sent.find((e) => e.eventName === "view")!;
      expect(view.attributes!["session.id"]).toBe(finalized[0].attributes!["session.id"]);
    });
  });
}
