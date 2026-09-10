import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TelemetryEvent } from "./core/telemetry";
import { memoryStore } from "./core/memoryStore";

// #104 / §5.1 — `metric.unit`, the measured `frame.target_fps` and the per-view frame
// window, asserted where the contract lives: the TelemetryEvent[] that reaches the injected
// Sender. Keys, values and **absence** — `frame.target_hz` must be gone and metrics stay
// Tier 3 (trace-free).

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  Dimensions: { get: () => ({ width: 390, height: 844 }) },
  PixelRatio: { get: () => 3 },
  AppState: { currentState: "active", addEventListener: () => {} },
}));
vi.mock("react-native-get-random-values", () => ({}));
vi.mock("react-native-device-info", () => ({
  default: new Proxy({}, { get: () => async () => "x" }),
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

/** Spin the microtask queue: fake timers do not drain the promise chains behind log(). */
async function settle() {
  for (let i = 0; i < 200; i++) await Promise.resolve();
}

/** A hand-driven display: one `frame(ms)` = one vsync `ms` after the last. */
function display() {
  let now = 0;
  let cb: (() => void) | undefined;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (fn: () => void) => { cb = fn; return 1; });
  return {
    ready: () => cb !== undefined,
    frame(ms: number) { now += ms; cb?.(); },
    frames(count: number, ms: number) { for (let i = 0; i < count; i++) this.frame(ms); },
  };
}

async function launch() {
  const { createTelemetry } = await import("./createTelemetry.native");
  const sent: TelemetryEvent[] = [];
  const t = createTelemetry({
    apiKey: "edge_frames",
    endpoint: "https://collector/telemetry",
    sender: { send: async (e: TelemetryEvent[]) => { sent.push(...e); } },
    store: memoryStore(),
    batchSize: 500,
    flushIntervalMs: 0,
  });
  await settle();
  return { t, sent };
}

const framesOf = (sent: TelemetryEvent[]) =>
  sent.filter((e) => e.type === "metric" && e.metricName === "frame_render_time");

beforeEach(() => {
  silenceConsole();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-14T10:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("#104 frame metrics on the wire (§5.1)", () => {
  it("ships metric.unit, a measured frame.target_fps and window_duration_ms — and no target_hz", async () => {
    const d = display();
    const { t, sent } = await launch();
    await vi.waitFor(() => expect(d.ready()).toBe(true));

    d.frames(1400, 1000 / 120);         // a 120 Hz stream, well past the 10s window
    await settle();
    await t.flush();

    const rows = framesOf(sent);
    expect(rows.length).toBeGreaterThan(0);
    const a = rows[0].attributes!;
    expect(a["metric.unit"]).toBe("ms");
    expect(a["frame.target_fps"]).toBe(120);
    expect(a).not.toHaveProperty("frame.target_hz");
    expect(a["frame.window_duration_ms"]).toBeGreaterThanOrEqual(10000);
    expect(a["frame.source"]).toBe("requestAnimationFrame");
    // Tier 3: a windowed aggregate belongs to no single action (§6.3).
    for (const k of ["trace.id", "span.id", "parent.span.id", "rum.action.id", "trace.root_type"]) {
      expect(a).not.toHaveProperty(k);
    }
  });

  it("measures 60 Hz as 60", async () => {
    const d = display();
    const { t, sent } = await launch();
    await vi.waitFor(() => expect(d.ready()).toBe(true));

    d.frames(700, 1000 / 60);
    await settle();
    await t.flush();

    expect(framesOf(sent)[0].attributes!["frame.target_fps"]).toBe(60);
  });

  it("resets the window at a route change and books the frames to the departing view", async () => {
    const d = display();
    const { t, sent } = await launch();
    await vi.waitFor(() => expect(d.ready()).toBe(true));

    // Rung 2 over rung 0 upgrades the launch view in place — no boundary, no successor.
    await (t as any).trackRoute("", "Home");
    await settle();

    d.frames(30, 1000 / 60);            // ~500ms, nowhere near the 10s window
    await settle();
    await t.flush();
    expect(framesOf(sent)).toHaveLength(0);

    // Same rung, different name: a genuine navigation, so the view exits.
    await (t as any).trackRoute("Home", "Cart");
    await settle();
    await t.flush();

    const rows = framesOf(sent);
    expect(rows).toHaveLength(1);
    // The whole point of the reset: the departing screen's frames, on the departing view.
    const departing = sent.find((e) => e.eventName === "view")!.attributes!;
    expect(departing["view.name"]).toBe("Home");
    expect(rows[0].attributes!["view.id"]).toBe(departing["view.id"]);
    expect(rows[0].attributes!["view.name"]).toBe("Home");
    expect(rows[0].attributes!["frame.window_duration_ms"]).toBeLessThan(10000);
  });
});
