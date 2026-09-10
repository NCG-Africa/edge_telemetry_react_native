import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TelemetryEvent } from "./core/telemetry";
import { memoryStore } from "./core/memoryStore";
import type { AsyncStore } from "./core/store";

// #93 native mirror of sampling.web.test.ts. Same seam, same contract; the point of the
// native file is that both options live in shared core and therefore behave identically
// over the *asynchronous* Store, which is where a sticky decision is easiest to lose.

const MIN = 60 * 1000;

vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  AppState: { currentState: "active", addEventListener: () => {} },
}));
vi.mock("react-native-get-random-values", () => ({}));
vi.mock("react-native-device-info", () => ({
  default: {
    getApplicationName: async () => "NativeApp",
    getVersion: async () => "2.3.4",
    getBuildNumber: async () => "77",
    getBundleId: async () => "com.example.app",
    getBrand: async () => "Pixel",
    getManufacturer: async () => "Google",
    getModel: async () => "Pixel 8",
    getSystemVersion: async () => "14",
    getSystemName: async () => "Android",
    getDeviceName: async () => "dev",
    getApiLevel: async () => 34,
    getFingerprint: async () => "fp",
    getHardware: async () => "hw",
    getProduct: async () => "prod",
  },
}));
vi.mock("@react-native-community/netinfo", () => ({
  default: { fetch: async () => ({ type: "wifi", isConnected: true }), addEventListener: () => {} },
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

function silenceConsole() {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
}

type LaunchOpts = {
  store?: AsyncStore;
  beforeSend?: (e: TelemetryEvent) => TelemetryEvent | null;
  sessionSampleRate?: number;
  sender?: any;
};

/** One RN process: a fresh SDK over shared persistence, plus everything it sent. */
async function launch(opts: LaunchOpts = {}) {
  const { createTelemetry } = await import("./createTelemetry.native");
  const sent: TelemetryEvent[] = [];
  const t = createTelemetry({
    apiKey: "edge_sampling",
    endpoint: "https://x/telemetry",
    sender: opts.sender ?? { send: async (e: TelemetryEvent[]) => { sent.push(...e); } },
    store: opts.store,
    beforeSend: opts.beforeSend,
    sessionSampleRate: opts.sessionSampleRate,
    batchSize: 50,
    flushIntervalMs: 0,
  });
  return { t, sent, names: () => sent.map((e) => e.eventName ?? e.metricName) };
}

const attrsOf = (sent: TelemetryEvent[], name: string) =>
  sent.filter((e) => e.eventName === name).map((e) => e.attributes!);

beforeEach(() => {
  silenceConsole();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-14T10:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("#93 native — beforeSend", () => {
  it("re-stamps Tier A and Tier B, and drops what the hook actually meant to drop", async () => {
    const { t, sent } = await launch({
      beforeSend: (e) => {
        for (const k of Object.keys(e.attributes!)) delete e.attributes![k];
        return e;
      },
    });

    await t.log("navigation", { "navigation.to_screen": "Home" });
    await t.flush();

    const a = attrsOf(sent, "navigation")[0];
    expect(a["session.id"]).toMatch(/^session_\d+_[0-9a-f]{16}_android$/);
    expect(a["sdk.version"]).toBeDefined();
    expect(a["app.name"]).toBe("NativeApp");             // all app.* is Tier A
    expect(a["device.platform"]).toBeDefined();
    expect(a["device.id"]).toMatch(/^device_/);
    expect(a["navigation.to_screen"]).toBeUndefined();
  });

  it("separates a broken hook from an over-broad one", async () => {
    let mode: "throw" | "null" | "pass" = "throw";
    const { t, sent } = await launch({
      beforeSend: (e) => {
        if (mode === "throw") throw new Error("bug in the scrubber");
        return mode === "null" ? null : e;
      },
    });

    await t.log("custom_event");   // throws → failed
    mode = "null";
    await t.log("custom_event");   // null → dropped
    mode = "pass";
    await t.log("navigation");
    await t.flush();

    expect(sent.map((e) => e.eventName)).toEqual(["navigation"]);
    const a = attrsOf(sent, "navigation")[0];
    expect(a["sdk.hook_failed"]).toBe(3);    // session.started + app.start + the first custom_event
    expect(a["sdk.hook_dropped"]).toBe(1);
  });
});

describe("#93 native — sessionSampleRate over the async Store", () => {
  it("a sampled-out session sends zero payloads, crashes included", async () => {
    const send = vi.fn(async () => {});
    const { t } = await launch({ sessionSampleRate: 0, sender: { send } });

    await t.log("custom_event");
    await t.log("app.crash", { "error.message": "boom" });
    await t.flush();

    expect(send).not.toHaveBeenCalled();
  });

  it("the decision survives process death and is re-rolled only at rotation", async () => {
    const store = memoryStore({ async: true });
    const roll = vi.spyOn(Math, "random").mockReturnValue(0.9);   // sampled out at 0.5

    const first = await launch({ store, sessionSampleRate: 0.5 });
    await first.t.log("custom_event");
    await first.t.flush();
    expect(first.sent).toHaveLength(0);

    roll.mockReturnValue(0.1);   // a roll that would sample in — a resume must ignore it
    vi.setSystemTime(Date.now() + 10 * MIN);
    const second = await launch({ store, sessionSampleRate: 0.5 });
    await second.t.log("custom_event");
    await second.t.flush();
    expect(second.sent).toHaveLength(0);

    vi.setSystemTime(Date.now() + 45 * MIN);
    const third = await launch({ store, sessionSampleRate: 0.5 });
    await third.t.log("custom_event");
    await third.t.flush();
    // `app.start` is once per *process*, so each relaunch emits its own (§6.2).
    expect(third.names()).toEqual(["session.started", "app.start", "custom_event"]);
    for (const e of third.sent) expect(e.attributes!["session.sample_rate"]).toBe(0.5);
  });
});
