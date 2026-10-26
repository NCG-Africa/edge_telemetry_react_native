import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TelemetryEvent } from "./core/telemetry";
import { memoryStore } from "./core/memoryStore";

// #171 — `markScreenReady()` at the `createTelemetry({ sender, store })` seam on both builds.

const lifecycle = vi.hoisted(() => {
  const listeners: Array<(s: string) => void> = [];
  return { state: "active", listeners, set(s: string) { lifecycle.state = s; for (const fn of [...listeners]) fn(s); } };
});
vi.mock("react-native", () => ({
  Dimensions: { get: () => ({ width: 390, height: 844 }) }, PixelRatio: { get: () => 3 }, Platform: { OS: "android" },
  AppState: {
    get currentState() { return lifecycle.state; },
    addEventListener: (_t: string, fn: (s: string) => void) => { lifecycle.listeners.push(fn); },
  },
}));
vi.mock("react-native-get-random-values", () => ({}));
vi.mock("react-native-device-info", () => ({ default: new Proxy({}, { get: () => async () => "x" }) }));
vi.mock("@react-native-community/netinfo", () => ({
  default: { fetch: async () => ({ type: "wifi", isConnected: true }), addEventListener: () => {} },
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

const g = globalThis as any;
const T0 = Date.parse("2026-06-14T10:00:00.000Z");
const settle = async () => { for (let i = 0; i < 30; i++) await vi.advanceTimersByTimeAsync(0); };

for (const build of ["native", "web"] as const) {
  describe(`#171 markScreenReady (${build})`, () => {
    const saved = { document: g.document, startup: (performance as any).rnStartupTiming };
    beforeEach(() => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
      vi.setSystemTime(T0);
      lifecycle.listeners.length = 0;
      lifecycle.state = "active";
      if (build === "web") {
        const handlers: Array<() => void> = [];
        g.document = {
          visibilityState: "visible",
          addEventListener: (t: string, fn: () => void) => { if (t === "visibilitychange") handlers.push(fn); },
          removeEventListener: () => {},
        };
        lifecycle.listeners.push((s) => { g.document.visibilityState = s === "active" ? "visible" : "hidden"; for (const fn of handlers) fn(); });
      }
    });
    afterEach(() => {
      g.document = saved.document;
      (performance as any).rnStartupTiming = saved.startup;
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    async function launch(early?: (t: any) => void) {
      const { createTelemetry } = build === "native" ? await import("./createTelemetry.native") : await import("./createTelemetry.web");
      const sent: TelemetryEvent[] = [];
      const t = createTelemetry({
        apiKey: "edge_ready", endpoint: "https://x/telemetry",
        sender: { send: async (e: TelemetryEvent[]) => { sent.push(...e); } },
        store: memoryStore() as any, batchSize: 500, flushIntervalMs: 0,
      });
      early?.(t);
      const inst = await (t as any).instancePromise;
      await settle();
      return { t, inst, sent };
    }
    const views = (sent: TelemetryEvent[]) => sent.filter((e) => e.eventName === "view").map((e) => e.attributes!);
    const viewNamed = (sent: TelemetryEvent[], name: string) => views(sent).filter((v) => v["view.name"] === name);

    it("a route view's ready_time is mark − entry; first mark wins; present ⇔ outcome ready", async () => {
      const { t, inst, sent } = await launch();
      await inst.enterView("Home", "route");
      await inst.enterView("Cart", "route");
      await vi.advanceTimersByTimeAsync(300);
      t.markScreenReady();
      await vi.advanceTimersByTimeAsync(200);
      t.markScreenReady();   // later mark: ignored
      await settle();
      await inst.enterView("Pay", "route");
      await t.flush();

      const [cart] = viewNamed(sent, "Cart");
      expect(cart).toMatchObject({ "view.ready_time": 300, "view.ready_outcome": "ready" });
      for (const v of views(sent)) expect("view.ready_time" in v).toBe(v["view.ready_outcome"] === "ready");
    });

    it("`abandoned` only for a screen marked before this process, only on route change", async () => {
      const { t, inst, sent } = await launch();
      await inst.enterView("Home", "route");
      await inst.enterView("Feed", "route");
      t.markScreenReady();
      await settle();
      await inst.enterView("Never", "route");   // Feed: ready. Never: not instrumented
      await inst.enterView("Feed", "route");    // Never exits unjudged
      await inst.enterView("Home", "route");    // Feed exits with no mark → abandoned
      await t.flush();

      const feed = viewNamed(sent, "Feed");
      expect(feed[0]["view.ready_outcome"]).toBe("ready");
      expect(feed[1]["view.ready_outcome"]).toBe("abandoned");
      expect(feed[1]).not.toHaveProperty("view.ready_time");
      expect(viewNamed(sent, "Never")[0]).not.toHaveProperty("view.ready_outcome");
    });

    it("background exits are not judged, and a resume successor ignores a mark", async () => {
      const { t, inst, sent } = await launch();
      await inst.enterView("Home", "route");
      await inst.enterView("Feed", "route");
      t.markScreenReady();
      await settle();
      await inst.enterView("Home", "route");
      await inst.enterView("Feed", "route");    // second visit, unmarked
      lifecycle.set("background");
      await settle();
      lifecycle.set("active");
      await settle();
      t.markScreenReady();                      // on the resume successor: no token
      await settle();
      await inst.enterView("Home", "route");
      await t.flush();

      const feed = viewNamed(sent, "Feed");
      expect(feed).toHaveLength(3);
      expect(feed[1]).not.toHaveProperty("view.ready_outcome");   // left by background
      expect(feed[2]).not.toHaveProperty("view.ready_outcome");   // resume successor
    });

    it("a mount-effect mark binds a macrotask later — to the view the navigation is opening", async () => {
      const { t, inst, sent } = await launch();
      await inst.enterView("Home", "route");
      t.markScreenReady();                       // stamped now, while Home is still current…
      const nav = inst.enterView("Details", "route");   // …and the route change lands behind it
      await nav;
      await settle();
      await inst.enterView("Home", "route");
      await t.flush();
      expect(viewNamed(sent, "Home")[0]).not.toHaveProperty("view.ready_outcome");
      expect(viewNamed(sent, "Details")[0]).toMatchObject({ "view.ready_outcome": "ready", "view.ready_time": 0 });
    });

    it("the initial view anchors at process start; a pre-init mark is buffered onto it", async () => {
      if (build === "native") {
        (performance as any).rnStartupTiming = { startTime: T0 - 1200, executeJavaScriptBundleEntryPointEnd: T0 - 400 };
      }
      const { t, inst, sent } = await launch((tel) => tel.markScreenReady());
      await inst.enterView("Home", "route");     // names the initial view in place
      await inst.enterView("Next", "route");
      await t.flush();

      const [home] = viewNamed(sent, "Home");
      expect(home["view.load_type"]).toBe("initial_load");
      const anchor = build === "native" ? T0 - 1200 : performance.timeOrigin;
      expect(home).toMatchObject({ "view.ready_outcome": "ready", "view.ready_time": Math.max(0, T0 - anchor) });
      const start = sent.find((e) => e.eventName === "app.start")!.attributes!;
      if (build === "native") expect(start["app.start.js_ready_ms"]).toBe(800);
      else expect(start).not.toHaveProperty("app.start.js_ready_ms");
    });

    if (build === "native") {
      it("no process-start marker: the initial view is not judged and js_ready_ms is omitted", async () => {
        (performance as any).rnStartupTiming = undefined;
        const { t, inst, sent } = await launch((tel) => tel.markScreenReady());
        await inst.enterView("Home", "route");
        await inst.enterView("Next", "route");
        await t.flush();
        expect(viewNamed(sent, "Home")[0]).not.toHaveProperty("view.ready_outcome");
        expect(sent.find((e) => e.eventName === "app.start")!.attributes).not.toHaveProperty("app.start.js_ready_ms");
      });
    }
  });
}
