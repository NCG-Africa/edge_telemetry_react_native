import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TelemetryEvent } from "./core/telemetry";
import { memoryStore } from "./core/memoryStore";

// #173 — battery on failure rows (native), accessibility on session.started (both), at the
// createTelemetry seam. The 39-key Context block is untouched.

const dev = vi.hoisted(() => ({
  level: 0.42 as unknown, charging: true as unknown, lowPowerMode: false as unknown,
  reads: 0, screenReader: true as unknown, reduceMotion: false as unknown, fontScale: 1.3 as unknown,
}));
vi.mock("react-native", () => ({
  Dimensions: { get: () => ({ width: 390, height: 844 }) },
  PixelRatio: { get: () => 3, getFontScale: () => dev.fontScale },
  Platform: { OS: "android" },
  AppState: { currentState: "active", addEventListener: () => {} },
  AccessibilityInfo: {
    isScreenReaderEnabled: async () => dev.screenReader,
    isReduceMotionEnabled: async () => { if (dev.reduceMotion instanceof Error) throw dev.reduceMotion; return dev.reduceMotion; },
  },
}));
vi.mock("react-native-get-random-values", () => ({}));
vi.mock("react-native-device-info", () => ({
  default: new Proxy({}, {
    get: (_t, k) => {
      if (k === "getBatteryLevel") return async () => { dev.reads++; return dev.level; };
      if (k === "isBatteryCharging") return async () => dev.charging;
      if (k === "getPowerState") return async () => ({ lowPowerMode: dev.lowPowerMode });
      return async () => "x";
    },
  }),
}));
vi.mock("@react-native-community/netinfo", () => ({
  default: { fetch: async () => ({ type: "wifi", isConnected: true }), addEventListener: () => {} },
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

const g = globalThis as any;
const settle = async () => { for (let i = 0; i < 30; i++) await vi.advanceTimersByTimeAsync(0); };
const BATTERY = ["device.battery_level", "device.battery_charging", "device.power_save"];

for (const build of ["native", "web"] as const) {
  describe(`#173 device state (${build})`, () => {
    const saved = g.matchMedia;
    beforeEach(() => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.useFakeTimers();
      Object.assign(dev, { level: 0.42, charging: true, lowPowerMode: false, reads: 0, screenReader: true, reduceMotion: false, fontScale: 1.3 });
      g.matchMedia = (q: string) => ({ matches: q === "(prefers-reduced-motion: reduce)" });
    });
    afterEach(() => { g.matchMedia = saved; vi.useRealTimers(); vi.restoreAllMocks(); });

    async function launch() {
      const { createTelemetry } = build === "native" ? await import("./createTelemetry.native") : await import("./createTelemetry.web");
      const sent: TelemetryEvent[] = [];
      const t = createTelemetry({
        apiKey: "edge_state", endpoint: "https://x/telemetry",
        sender: { send: async (e: TelemetryEvent[]) => { sent.push(...e); } },
        store: memoryStore() as any, batchSize: 500, flushIntervalMs: 0,
      });
      const inst = await (t as any).instancePromise;
      await settle();
      return { t, inst, sent };
    }
    const row = (sent: TelemetryEvent[], name: string) => sent.filter((e) => e.eventName === name).slice(-1)[0].attributes!;

    it("accessibility rides session.started only", async () => {
      const { t, sent } = await launch();
      await t.log("custom_event");
      await t.flush();
      const started = row(sent, "session.started");
      if (build === "native") {
        expect(started).toMatchObject({ "device.screen_reader": true, "device.reduce_motion": false, "device.font_scale": 1.3 });
      } else {
        expect(started).toMatchObject({ "device.reduce_motion": true });
        expect(started).not.toHaveProperty("device.screen_reader");
        expect(started).not.toHaveProperty("device.font_scale");
      }
      expect(row(sent, "custom_event")).not.toHaveProperty("device.reduce_motion");
    });

    it("battery rides failure rows only, native only, from the cache", async () => {
      const { t, inst, sent } = await launch();
      await t.captureError(new Error("x"));
      await inst.log("app.crash", { "error.message": "y" });
      await t.log("custom_event");
      await t.flush();
      for (const name of ["app.error", "app.crash"]) {
        const r = row(sent, name);
        if (build === "native") expect(r).toMatchObject({ "device.battery_level": 42, "device.battery_charging": true, "device.power_save": false });
        else for (const k of BATTERY) expect(r).not.toHaveProperty(k);
      }
      for (const k of BATTERY) expect(row(sent, "custom_event")).not.toHaveProperty(k);
    });

    if (build === "native") {
      it("refreshes every 60 s; a sentinel is omitted; a failed accessibility read omits only its key", async () => {
        dev.reduceMotion = new Error("bridge down");
        const { t, inst, sent } = await launch();
        dev.level = -1;   // simulator sentinel
        dev.charging = false;
        await vi.advanceTimersByTimeAsync(60000);
        await settle();
        await t.captureError(new Error("x"));
        await t.flush();
        const r = row(sent, "app.error");
        expect(r).not.toHaveProperty("device.battery_level");
        expect(r["device.battery_charging"]).toBe(false);
        const started = row(sent, "session.started");
        expect(started).not.toHaveProperty("device.reduce_motion");
        expect(started["device.screen_reader"]).toBe(true);

        const before = dev.reads;
        t.disable();
        await vi.advanceTimersByTimeAsync(180000);
        expect(dev.reads).toBe(before);   // the refresh timer is stopped
        void inst;
      });
    }
  });
}
