import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TelemetryEvent } from "./core/telemetry";
import { memoryStore } from "./core/memoryStore";

// #165 — `app.hang` at the `createTelemetry({ sender, store })` seam on both builds. The
// monotonic clock is stubbed so a stall can be staged between two fake-timer ticks.

const lifecycle = vi.hoisted(() => {
  const listeners: Array<(s: string) => void> = [];
  return {
    state: "active",
    listeners,
    set(s: string) { lifecycle.state = s; for (const fn of [...listeners]) fn(s); },
  };
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
let mono = 0;
const settle = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };

for (const build of ["native", "web"] as const) {
  describe(`#165 app.hang (${build})`, () => {
    const saved = { dev: g.__DEV__, document: g.document };
    beforeEach(() => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-14T10:00:00.000Z"));
      mono = 0;
      vi.spyOn(performance, "now").mockImplementation(() => mono);
      g.__DEV__ = false;
      lifecycle.listeners.length = 0;
      lifecycle.state = "active";
      if (build === "web") {
        const handlers: Array<() => void> = [];
        g.document = {
          visibilityState: "visible",
          addEventListener: (t: string, fn: () => void) => { if (t === "visibilitychange") handlers.push(fn); },
          removeEventListener: () => {},
        };
        lifecycle.listeners.push((s) => {
          g.document.visibilityState = s === "active" ? "visible" : "hidden";
          for (const fn of handlers) fn();
        });
      }
    });
    afterEach(() => {
      g.__DEV__ = saved.dev;
      g.document = saved.document;
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    async function launch() {
      const { createTelemetry } = build === "native"
        ? await import("./createTelemetry.native")
        : await import("./createTelemetry.web");
      const sent: TelemetryEvent[] = [];
      const t = createTelemetry({
        apiKey: "edge_hang", endpoint: "https://x/telemetry",
        sender: { send: async (e: TelemetryEvent[]) => { sent.push(...e); } },
        store: memoryStore() as any, batchSize: 500, flushIntervalMs: 0,
      });
      const inst = await (t as any).instancePromise;
      for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(0);
      // The lifecycle adapter arms the detector after a cold dynamic import, which is real
      // I/O on the first test of a file, not a microtask: wait for it rather than guess.
      if (g.__DEV__ === false) await vi.waitFor(() => expect((inst.hangs as any)?.timer).toBeDefined());
      return { t, inst, sent };
    }

    /** One tick on schedule, with `extra` ms of frozen thread in front of it. */
    async function tick(extra = 0) {
      mono += 1000 + extra;
      vi.setSystemTime(Date.now() + extra);
      await vi.advanceTimersByTimeAsync(1000);
      await settle();
    }
    const hangs = (sent: TelemetryEvent[]) => sent.filter((e) => e.eventName === "app.hang");

    it("a 2 s+ stall emits one app.hang, attributed to the last good tick, and is no error", async () => {
      const { t, inst, sent } = await launch();
      await tick();
      await inst.enterView("Home", "route");
      await tick();
      const lastGoodBy = Date.now();   // the last good tick fired in (lastGoodBy − 1 s, lastGoodBy]
      await inst.enterView("Checkout", "route");
      await tick(2500);
      await tick();
      await t.log("custom_event");
      await t.flush();

      const [hang, ...more] = hangs(sent);
      expect(more).toEqual([]);
      const at = Date.parse(hang.timestamp);
      expect(at).toBeLessThanOrEqual(lastGoodBy);
      expect(at).toBeGreaterThan(lastGoodBy - 1000);
      expect(hang.attributes!["hang.duration_ms"]).toBe(2500);
      expect(hang.attributes!["view.name"]).toBe("Home");
      expect(JSON.parse(hang.attributes!["error.breadcrumbs"])).toEqual(expect.any(Array));
      expect(hang.attributes).not.toHaveProperty("error.stacktrace");
      expect(hang.attributes).not.toHaveProperty("span.id");   // Tier 2: never a span

      const views = sent.filter((e) => e.eventName === "view").map((e) => e.attributes!);
      for (const v of views) expect(v["view.error_count"]).toBe(0);
      const custom = sent.filter((e) => e.eventName === "custom_event").slice(-1)[0];
      expect(custom.attributes!["event.sequence"]).toBeGreaterThan(hang.attributes!["event.sequence"]);
    });

    it("under 2 s, over 60 s, and while backgrounded are not hangs", async () => {
      const { t, sent } = await launch();
      await tick(1999);
      await tick(61000);
      lifecycle.set("background");
      await settle();
      mono += 30000;   // a long background: the detector is stopped
      lifecycle.set("active");
      await settle();
      await tick();
      await t.flush();
      expect(hangs(sent)).toEqual([]);
    });

    it("off under __DEV__ — a debugger pause is not a hang", async () => {
      g.__DEV__ = true;
      const { t, sent } = await launch();
      await tick();
      await tick(5000);
      await t.flush();
      expect(hangs(sent)).toEqual([]);
    });

    it("shutdown stops the timer", async () => {
      const { t, sent } = await launch();
      await tick();
      await t.shutdown();
      await tick(5000);
      await tick();
      await t.flush();
      expect(hangs(sent)).toEqual([]);
    });
  });
}
