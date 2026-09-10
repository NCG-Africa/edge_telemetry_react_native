import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TelemetryEvent } from "./core/telemetry";
import { memoryStore } from "./core/memoryStore";
import type { AsyncStore } from "./core/store";

// #92 native mirror of session.lifecycle.web.test.ts. Same seam: public API in,
// the injected Sender's TelemetryEvent[] out. The point of the native file is the
// asynchronous Store and the AppState transitions that no longer rotate anything.

const MIN = 60 * 1000;

const appState = vi.hoisted(() => {
  const listeners: ((s: string) => void)[] = [];
  return {
    currentState: "active",
    addEventListener: (_: string, fn: (s: string) => void) => { listeners.push(fn); },
    emit(next: string) { appState.currentState = next; listeners.forEach((fn) => fn(next)); },
    listenerCount: () => listeners.length,
    // deliberately not clearing `listeners`: an earlier test's attach can still land here,
    // so each test takes a baseline count rather than assuming an empty list
    reset() { appState.currentState = "active"; },
  };
});

vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  Dimensions: { get: () => ({ width: 390, height: 844 }) },
  PixelRatio: { get: () => 3 },
  AppState: appState,
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

/** One RN process: a fresh SDK over shared persistence, plus everything it sent. */
async function launch(store: AsyncStore) {
  const { createTelemetry } = await import("./createTelemetry.native");
  const sent: TelemetryEvent[] = [];
  const t = createTelemetry({
    apiKey: "edge_session",
    endpoint: "https://x/telemetry",
    sender: { send: async (e: TelemetryEvent[]) => { sent.push(...e); } },
    store,
    batchSize: 50,
    flushIntervalMs: 0,
  });
  return { t, sent, names: () => sent.map((e) => e.eventName) };
}

const attrsOf = (sent: TelemetryEvent[], name: string) =>
  sent.filter((e) => e.eventName === name).map((e) => e.attributes!);

beforeEach(() => {
  silenceConsole();
  appState.reset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-14T10:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("#92 native session continuity — the async Store resumes across process death", () => {
  it("a relaunch inside 30 min continues the same session.id and emits no second session.started", async () => {
    const store = memoryStore({ async: true });

    const first = await launch(store);
    await first.t.log("custom_event");
    await first.t.flush();
    const id = attrsOf(first.sent, "custom_event")[0]["session.id"];
    expect(id).toMatch(/^session_\d+_[0-9a-f]{16}_android$/);

    vi.setSystemTime(Date.now() + 29 * MIN);   // process killed and relaunched

    const second = await launch(store);
    await second.t.log("custom_event");
    await second.t.flush();

    expect(attrsOf(second.sent, "custom_event")[0]["session.id"]).toBe(id);
    expect(second.names()).not.toContain("session.started");
  });

  it("a relaunch after 30 min idle rotates, with the idle reason", async () => {
    const store = memoryStore({ async: true });

    const first = await launch(store);
    await first.t.log("custom_event");
    await first.t.flush();
    const id = attrsOf(first.sent, "custom_event")[0]["session.id"];

    vi.setSystemTime(Date.now() + 31 * MIN);

    const second = await launch(store);
    await second.t.log("custom_event");
    await second.t.flush();

    expect(attrsOf(second.sent, "session.finalized")[0]["session.reason"]).toBe("idle");
    expect(attrsOf(second.sent, "session.finalized")[0]["session.id"]).toBe(id);
    expect(attrsOf(second.sent, "session.started")[0]["session.reason"]).toBe("idle");
    expect(attrsOf(second.sent, "custom_event")[0]["session.id"]).not.toBe(id);
  });
});

describe("#92 native lifecycle transitions no longer touch the session (§4.2)", () => {
  it("background then foreground keeps one session: no finalize, no second started", async () => {
    const before = appState.listenerCount();
    const { t, sent, names } = await launch(memoryStore({ async: true }));
    await t.log("custom_event");
    await t.flush();
    const id = attrsOf(sent, "custom_event")[0]["session.id"];

    // the AppState listener attaches asynchronously behind instancePromise
    await vi.waitFor(() => expect(appState.listenerCount()).toBeGreaterThan(before));
    appState.emit("background");
    vi.setSystemTime(Date.now() + 5 * MIN);
    appState.emit("active");

    await t.log("custom_event");
    await vi.waitFor(async () => {
      await t.flush();
      expect(names().filter((n) => n === "app_lifecycle")).toHaveLength(2);
    });

    expect(names()).not.toContain("session.finalized");
    expect(names().filter((n) => n === "session.started")).toHaveLength(1);
    expect(attrsOf(sent, "custom_event")[1]["session.id"]).toBe(id);
  });

  it("still flushes on background — the queue only lives in memory and the process may not come back", async () => {
    const before = appState.listenerCount();
    const { t, sent, names } = await launch(memoryStore({ async: true }));
    await t.flush();
    sent.length = 0;

    await vi.waitFor(() => expect(appState.listenerCount()).toBeGreaterThan(before));
    await t.log("custom_event");
    expect(names()).not.toContain("custom_event");   // batchSize 50: still queued

    appState.emit("background");
    await vi.waitFor(() => expect(names()).toContain("custom_event"));
  });
});
