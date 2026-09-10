import { describe, it, expect, vi, afterEach } from "vitest";
import type { TelemetryEvent } from "./core/telemetry";

// §4.7 removes the public path to `app.crash` (#100), so a test that needs one drives the
// same core the platform crash handler drives.
const crash = async (t: any, data?: Record<string, any>) =>
  (await (t as any).instancePromise).log("app.crash", data);


// Native mirror of transport.web.test.ts (#94). Same assertions on the wire; the two that
// differ are here because they are where the two builds genuinely differ — the offline
// store's write is a Promise, so the crash-loss window narrows here rather than closing.
vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  AppState: { currentState: "active", addEventListener: () => {} },
}));
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
  },
}));
vi.mock("@react-native-community/netinfo", () => ({
  default: { fetch: async () => ({ type: "wifi", isConnected: true }), addEventListener: () => {} },
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

afterEach(() => vi.restoreAllMocks());

function silenceConsole() {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
}

function recordingSender() {
  const batches: TelemetryEvent[][] = [];
  const persisted: TelemetryEvent[][] = [];
  return {
    batches,
    persisted,
    sent: () => batches.flat(),
    sender: {
      send: async (e: TelemetryEvent[]) => { batches.push([...e]); },
      onFailure: async (e: TelemetryEvent[]) => { persisted.push([...e]); },
    },
  };
}

async function makeTelemetry(sender: any, opts: Record<string, any> = {}) {
  const { createTelemetry } = await import("./createTelemetry.native");
  return createTelemetry({
    apiKey: "edge_k", endpoint: "https://x/telemetry",
    sender, flushIntervalMs: 0, ...opts,
  });
}

describe("native transport hardening (#94)", () => {
  it("stamps a monotonic event.sequence on every row", async () => {
    silenceConsole();
    const r = recordingSender();
    const t = await makeTelemetry(r.sender, { batchSize: 50 });

    await t.log("navigation");
    await t.log("custom_event");
    await t.flush();

    const sent = r.sent();
    expect(sent.length).toBeGreaterThanOrEqual(3);
    expect(sent.map(e => e.attributes!["event.sequence"])).toEqual(sent.map((_, i) => i));
  });

  it("holds the queue at 500 with app.crash evicted last", async () => {
    silenceConsole();
    const r = recordingSender();
    const t = await makeTelemetry(r.sender, { batchSize: 5000 });

    await crash(t, { "error.message": "first" });
    await t.log("custom_event", { marker: "oldest-ordinary" });
    for (let i = 0; i < 600; i++) await t.log("custom_event", { i });
    await t.flush();

    expect(r.batches[r.batches.length - 1].length).toBeLessThanOrEqual(500);
    expect(r.sent().filter(e => e.eventName === "app.crash")).toHaveLength(1);
    expect(r.sent().some(e => e.attributes?.marker === "oldest-ordinary")).toBe(false);
  });

  it("gives a crash one round trip: the queue is persisted, one batch carries the crash", async () => {
    silenceConsole();
    const r = recordingSender();
    const t = await makeTelemetry(r.sender, { batchSize: 2 });

    await t.flush();                       // drain session.started + app.start
    await Promise.resolve(); await Promise.resolve();
    r.batches.length = 0;
    r.persisted.length = 0;

    await t.log("custom_event", { n: 2 });
    await crash(t, { "error.message": "boom" });

    expect(r.batches).toHaveLength(1);
    expect(r.batches[0][0].eventName).toBe("app.crash");
    // ⚠ On native the persist is an AsyncStorage round-trip, so this having been *awaited*
    // is not the same as it having landed — a SIGKILL can still outrun it. The window
    // narrows here; only web's synchronous localStorage closes it. See core/store.ts.
    expect(r.persisted).toHaveLength(1);
    expect(r.persisted[0].map(e => e.eventName)).toContain("app.crash");
  });

  it("omits sdk.drop_reason until a drop occurs", async () => {
    silenceConsole();
    const r = recordingSender();
    const t = await makeTelemetry(r.sender, { batchSize: 5000 });

    await t.log("navigation");
    await t.flush();
    expect(r.sent().every(e => !("sdk.drop_reason" in e.attributes!))).toBe(true);
    expect(r.sent().every(e => e.attributes!["sdk.events_dropped"] === 0)).toBe(true);
  });
});
