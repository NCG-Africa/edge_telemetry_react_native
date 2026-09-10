import { describe, it, expect, vi, afterEach } from "vitest";
import type { TelemetryEvent } from "./core/telemetry";
import { resetProfileWarning } from "./core/userProfile";

// Native mirror of profile.web.test.ts (§4.10, #107). Platform APIs are module-stubbed;
// the assertions are on the wire, not on any manager's private state.
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
    getDeviceName: async () => "dev",
    getApiLevel: async () => 34,
    getUsedMemory: async () => 100 * 1024 * 1024,
    getTotalMemory: async () => 4096 * 1024 * 1024,
  },
}));

vi.mock("@react-native-community/netinfo", () => ({
  default: { fetch: async () => ({ type: "wifi", isConnected: true }), addEventListener: () => {} },
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

afterEach(() => { vi.restoreAllMocks(); resetProfileWarning(); });

function silenceConsole() {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
}

async function harness() {
  const { createTelemetry } = await import("./createTelemetry.native");
  const sent: TelemetryEvent[] = [];
  const t = createTelemetry({
    apiKey: "edge_integration",
    endpoint: "https://x/telemetry",
    sender: { send: async (e: TelemetryEvent[]) => { sent.push(...e); } },
    batchSize: 100,
    flushIntervalMs: 0,
  });
  return { t, sent };
}

const PII = ["user.name", "user.email", "user.phone", "user.custom.plan", "user.custom_dropped"];

describe("user profile PII → user.profile.update only, native (§4.10)", () => {
  it("carries the profile on user.profile.update and on no other event", async () => {
    silenceConsole();
    const { t, sent } = await harness();

    await t.identify({
      userId: "u-1", name: "Ada Lovelace", email: "ada@x.io",
      phone: "+254700000000", customAttributes: { plan: "pro" },
    });
    await t.log("navigation", { "navigation.to_screen": "Home" });
    await t.flush();

    const a = sent.find((e) => e.eventName === "user.profile.update")!.attributes!;
    expect(a["user.name"]).toBe("Ada Lovelace");
    expect(a["user.email"]).toBe("ada@x.io");
    expect(a["user.phone"]).toBe("+254700000000");
    expect(a["user.custom.plan"]).toBe("pro");
    expect(a["user.id"]).toBe("u-1");

    for (const e of sent.filter((ev) => ev.eventName !== "user.profile.update")) {
      for (const key of PII) expect(key in e.attributes!).toBe(false);
    }
  });

  it("identify({ userId }) sets user.id, and the deleted six never ship", async () => {
    silenceConsole();
    const { t, sent } = await harness();

    await t.identify({ userId: "u-2", name: "Ada", avatar: "https://x/a.png" });
    await t.log("navigation", { "navigation.to_screen": "Known" });
    await t.flush();

    expect(sent.find((e) => e.attributes?.["navigation.to_screen"] === "Known")!
      .attributes!["user.id"]).toBe("u-2");
    for (const e of sent) {
      for (const key of ["user.fullName", "user.firstName", "user.lastName",
                         "user.avatar", "user.createdAt", "user.updatedAt"]) {
        expect(key in e.attributes!).toBe(false);
      }
    }
  });

  it("a cyclic custom value drops the key and never throws", async () => {
    silenceConsole();
    const { t, sent } = await harness();

    const cyclic: any = {};
    cyclic.self = cyclic;
    await expect(t.identify({ userId: "u-3", customAttributes: { cyclic, plan: "pro" } }))
      .resolves.not.toThrow();
    await t.flush();

    const a = sent.find((e) => e.eventName === "user.profile.update")!.attributes!;
    expect("user.custom.cyclic" in a).toBe(false);
    expect(a["user.custom.plan"]).toBe("pro");
    expect(a["user.custom_dropped"]).toBe(1);
  });
});
