import { describe, it, expect, vi, afterEach } from "vitest";
import { createTelemetry } from "./createTelemetry.web";
import type { TelemetryEvent } from "./core/telemetry";

// End-to-end through the public API: createTelemetry() → log() → fake Sender.
// Background DOM adapters are fire-and-forget in the ctor and reject harmlessly under node.
afterEach(() => vi.restoreAllMocks());

function silenceConsole() {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
}

describe("createTelemetry (web) — public API → wire", () => {
  it("ships a contract-valid event through the injected sender", async () => {
    silenceConsole();
    const sent: TelemetryEvent[] = [];
    const sender = { send: async (e: TelemetryEvent[]) => { sent.push(...e); } };

    const t = createTelemetry({
      apiKey: "edge_integration",
      endpoint: "https://x/collector/telemetry",
      sender,
      batchSize: 10,
      flushIntervalMs: 0,
    });

    await t.log("navigation", { "navigation.to_screen": "Home" });
    await t.flush();

    // session.started rides on init (#29); assert the navigation event is contract-valid
    expect(sent.some((e) => e.eventName === "session.started")).toBe(true);
    const e = sent.find((ev) => ev.eventName === "navigation")!;
    expect(e).toBeDefined();
    expect(e.type).toBe("event");
    expect(typeof e.timestamp).toBe("string");

    const a = e.attributes!;
    expect(a["sdk.platform"]).toBe("react-native");
    expect(a["sdk.version"]).toBe("3.0.0");
    // web build omits the OS id suffix (contract suffix is ios|android only)
    expect(a["session.id"]).toMatch(/^session_\d+_[0-9a-f]{16}$/);
    expect(a["user.id"]).toMatch(/^user_\d+_[0-9a-f]{16}$/);
  });

  it("never ships standalone device_info/network_info events, even after getDeviceInfo/getNetworkInfo", async () => {
    silenceConsole();
    const sent: TelemetryEvent[] = [];
    const sender = { send: async (e: TelemetryEvent[]) => { sent.push(...e); } };

    const t = createTelemetry({
      apiKey: "edge_integration",
      endpoint: "https://x/collector/telemetry",
      sender,
      batchSize: 10,
      flushIntervalMs: 0,
    });

    await t.getDeviceInfo();
    await t.getNetworkInfo();
    await t.log("custom_event");
    await t.flush();

    const names = sent.map((e) => e.eventName);
    expect(names).not.toContain("device_info");
    expect(names).not.toContain("network_info");
  });
});
