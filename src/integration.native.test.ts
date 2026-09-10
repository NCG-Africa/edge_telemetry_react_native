import { describe, it, expect, vi, afterEach } from "vitest";
import type { TelemetryEvent } from "./core/telemetry";

// Native mirror of integration.web.test.ts: drive the public API through
// createTelemetry({ sender }) and assert on what reaches the injected Sender.
// Platform APIs are module-stubbed; nothing reaches into private manager state.
vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  AppState: { currentState: "active", addEventListener: () => {} },
}));

vi.mock("react-native-device-info", () => ({
  default: {
    getUniqueId: async () => "device-abc",
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
  default: {
    fetch: async () => ({ type: "wifi", isConnected: true }),
    addEventListener: () => {},
  },
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

async function firstEventAttributes() {
  const { createTelemetry } = await import("./createTelemetry.native");
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

describe("createTelemetry (native) — Context keys are snake_case on the wire (#88)", () => {
  it("ships all seven respelled keys", async () => {
    silenceConsole();
    const a = await firstEventAttributes();

    expect(a["app.build_number"]).toBe("77");
    expect(a["app.package_name"]).toBe("com.example.app");
    expect(a["device.platform_version"]).toBe("14");
    expect(a["device.android_sdk"]).toBe("34");
    expect(a["device.android_release"]).toBe("14");
    expect(Object.keys(a)).toContain("device.ios_system_name");   // undefined off-iOS
    expect(a["network.is_connected"]).toBe(true);
  });

  it("ships none of the old camelCase spellings", async () => {
    silenceConsole();
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
