import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TelemetryEvent } from "./core/telemetry";
import { memoryStore } from "./core/memoryStore";

// #105 / §5.2 — `memory_usage` is native-only, RSS-sourced and actually *periodic*.
// Asserted where the contract lives: the TelemetryEvent[] reaching the injected Sender —
// keys, values and **absence** (`usage_mb`, `pressure_level`, `memory.unit` and every
// trace key must be gone).

const USED_BYTES = 128 * 1024 * 1024;
const TOTAL_BYTES = 4096 * 1024 * 1024;

// Plain vi.fn()s, re-armed in beforeEach: restoreAllMocks() strips an implementation
// passed to the constructor, so the impl has to be (re)set per test.
const getUsedMemory = vi.fn<() => Promise<number>>();
const getTotalMemory = vi.fn<() => Promise<number>>();

vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  AppState: { currentState: "active", addEventListener: () => {} },
}));
vi.mock("react-native-get-random-values", () => ({}));
vi.mock("react-native-device-info", () => ({
  default: new Proxy({}, {
    get: (_t, k) =>
      k === "getUsedMemory" ? getUsedMemory
        : k === "getTotalMemory" ? getTotalMemory
          : async () => "x",
  }),
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

/**
 * Drain the promise chains behind log(). Microtask spinning alone is not enough here: the
 * capture adapters are reached through dynamic `import()`, whose resolution needs a turn of
 * the real event loop, which `advanceTimersByTimeAsync(0)` yields without moving the clock.
 */
async function settle() {
  for (let pass = 0; pass < 5; pass++) {
    for (let i = 0; i < 100; i++) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
  }
}

/**
 * Flush until the first sample lands, bounded. The launch sample rides a chain of dynamic
 * imports whose length is a module-cache detail, not behaviour — polling for it keeps the
 * assertions about the wire rather than about how many turns the loader took.
 */
async function flushUntilSampled(t: { flush(): Promise<unknown> }, sent: TelemetryEvent[]) {
  for (let i = 0; i < 20 && samplesOf(sent).length === 0; i++) {
    await settle();
    await t.flush();
  }
}

/**
 * The same wait, unconditionally spent. An absence assertion has to outlast the window a
 * positive one would have used, or it passes for the wrong reason.
 */
async function flushFully(t: { flush(): Promise<unknown> }, sent: TelemetryEvent[]) {
  for (let i = 0; i < 20; i++) {
    await settle();
    await t.flush();
  }
  return sent;
}

async function launch() {
  const { createTelemetry } = await import("./createTelemetry.native");
  const sent: TelemetryEvent[] = [];
  const t = createTelemetry({
    apiKey: "edge_memory",
    endpoint: "https://collector/telemetry",
    sender: { send: async (e: TelemetryEvent[]) => { sent.push(...e); } },
    store: memoryStore(),
    batchSize: 500,
    flushIntervalMs: 0,
  });
  await settle();
  return { t, sent };
}

const samplesOf = (sent: TelemetryEvent[]) =>
  sent.filter((e) => e.type === "metric" && e.metricName === "memory_usage");

beforeEach(() => {
  silenceConsole();
  getUsedMemory.mockResolvedValue(USED_BYTES);
  getTotalMemory.mockResolvedValue(TOTAL_BYTES);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-14T10:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("#105 memory_usage on the native wire (§5.2)", () => {
  it("ships rss, total_mb and metric.unit — and none of the three retired keys", async () => {
    const { t, sent } = await launch();
    await flushUntilSampled(t, sent);

    const [s] = samplesOf(sent);
    expect(s).toBeDefined();
    expect(s.value).toBe(128);
    expect(s.attributes!["metric.unit"]).toBe("MB");
    expect(s.attributes!["memory.type"]).toBe("rss");
    expect(s.attributes!["memory.total_mb"]).toBe(4096);
    expect(s.attributes!["memory.source"]).toBe("android");

    for (const gone of ["memory.usage_mb", "memory.pressure_level", "memory.unit"]) {
      expect(gone in s.attributes!).toBe(false);
    }
  });

  it("is Tier 3 — a windowed sample belongs to no action, so it carries no trace keys", async () => {
    const { t, sent } = await launch();
    await flushUntilSampled(t, sent);

    const [s] = samplesOf(sent);
    for (const k of ["trace.id", "span.id", "parent.span.id", "rum.action.id", "trace.root_type"]) {
      expect(k in s.attributes!).toBe(false);
    }
  });

  it("keeps sampling over fake-timer time — the periodic sampler actually runs", async () => {
    const { t, sent } = await launch();
    await flushUntilSampled(t, sent);
    expect(samplesOf(sent).length).toBe(1);

    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(30000);
      await settle();
    }
    await t.flush();

    expect(samplesOf(sent).length).toBe(4);
  });

  it("still ships the resident figure when only the total read fails — total_mb just goes absent", async () => {
    getTotalMemory.mockRejectedValue(new Error("no such method"));
    const { t, sent } = await launch();
    await flushUntilSampled(t, sent);

    const [s] = samplesOf(sent);
    expect(s).toBeDefined();
    expect(s.value).toBe(128);
    expect("memory.total_mb" in s.attributes!).toBe(false);
  });

  it("stops sampling after shutdown() — the sampler owns a timer the rAF trackers do not", async () => {
    const { t, sent } = await launch();
    await flushUntilSampled(t, sent);
    expect(samplesOf(sent).length).toBe(1);

    await t.shutdown();
    await vi.advanceTimersByTimeAsync(120000);
    await settle();
    await t.flush();

    expect(samplesOf(sent).length).toBe(1);
  });

  it("emits nothing when the device-info read throws — no fabricated zero", async () => {
    getUsedMemory.mockRejectedValue(new Error("no such module"));
    const { t, sent } = await launch();
    await flushFully(t, sent);

    expect(samplesOf(sent).length).toBe(0);
    // Positive control: the rest of the SDK is alive, so the absence above is the read
    // failing and not a launch that never happened.
    expect(sent.some((e) => e.eventName === "session.started")).toBe(true);
  });

  it("a consumer calling the public trackMemoryUsage() does not open a second loop", async () => {
    const { t, sent } = await launch();
    await flushUntilSampled(t, sent);
    const atLaunch = samplesOf(sent).length;

    await t.trackMemoryUsage();          // auto-started in the constructor too
    await settle();
    await vi.advanceTimersByTimeAsync(30000);
    await settle();
    await t.flush();

    // one re-registration sample plus one tick — not two ticks from two live intervals
    expect(samplesOf(sent).length).toBe(atLaunch + 2);
  });
});

describe("#105 memory_usage is native-only (§5.2)", () => {
  it("the web build never emits it", async () => {
    vi.resetModules();
    const { createTelemetry } = await import("./createTelemetry.web");
    const sent: TelemetryEvent[] = [];
    const t = createTelemetry({
      apiKey: "edge_memory",
      endpoint: "https://collector/telemetry",
      sender: { send: async (e: TelemetryEvent[]) => { sent.push(...e); } },
      batchSize: 500,
      flushIntervalMs: 0,
    });
    await settle();
    await vi.advanceTimersByTimeAsync(120000);
    await flushFully(t, sent);

    expect(samplesOf(sent).length).toBe(0);
    // Positive control: this build is emitting, it just never emits *this* metric.
    expect(sent.some((e) => e.eventName === "session.started")).toBe(true);
  });
});
