import { describe, it, expect, vi, afterEach } from "vitest";
import { createTelemetry } from "./createTelemetry.web";
import type { TelemetryEvent } from "./core/telemetry";
import { version as PKG_VERSION } from "../package.json";

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
    expect(a["sdk.version"]).toBe(PKG_VERSION);   // tracks package.json, not a pinned literal
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

// #88 — the seven camelCase Context keys are respelled snake_case at the DeviceInfo /
// NetworkInfo interface. Asserted on the wire, where the contract lives (§9.3 / §3.3).
describe("createTelemetry (web) — Context keys are snake_case on the wire (#88)", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubDom() {
    vi.stubGlobal("document", {
      title: "WebApp",
      visibilityState: "visible",
      addEventListener: () => {},
    });
    vi.stubGlobal("window", {
      location: { hostname: "app.example.com", pathname: "/" },
      addEventListener: () => {},
    });
    vi.stubGlobal("navigator", {
      userAgent: "UA",
      platform: "MacIntel",
      appVersion: "5.0 (Macintosh)",
      vendor: "Acme",
      onLine: true,
    });
    process.env.BUILD_NUMBER = "42";
  }

  async function firstEventAttributes() {
    const sent: TelemetryEvent[] = [];
    const t = createTelemetry({
      apiKey: "edge_integration",
      endpoint: "https://x/collector/telemetry",
      sender: { send: async (e: TelemetryEvent[]) => { sent.push(...e); } },
      batchSize: 10,
      flushIntervalMs: 0,
      captureConsole: false,
    });
    await t.log("navigation", { "navigation.to_screen": "Home" });
    await t.flush();
    return sent.find((e) => e.eventName === "navigation")!.attributes!;
  }

  it("ships all seven respelled keys", async () => {
    silenceConsole();
    stubDom();
    const a = await firstEventAttributes();

    expect(a["app.build_number"]).toBe("42");
    expect(a["app.package_name"]).toBe("app.example.com");
    expect(a["device.platform_version"]).toBe("5.0 (Macintosh)");
    // undefined on web, but present under the respelled key (JSON drops them on the wire)
    expect(Object.keys(a)).toContain("device.android_sdk");
    expect(Object.keys(a)).toContain("device.android_release");
    expect(Object.keys(a)).toContain("device.ios_system_name");
    expect(a["network.is_connected"]).toBe(true);
  });

  it("ships none of the old camelCase spellings", async () => {
    silenceConsole();
    stubDom();
    const a = await firstEventAttributes();

    for (const dead of [
      "app.buildNumber", "app.packageName", "device.platformVersion",
      "device.androidSdk", "device.androidRelease", "device.iosSystemName",
      "network.isConnected",
    ]) {
      expect(Object.keys(a)).not.toContain(dead);
    }
  });
});
