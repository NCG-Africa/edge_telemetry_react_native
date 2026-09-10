import { describe, it, expect, vi, afterEach } from "vitest";
import type { TelemetryEvent } from "./core/telemetry";

// Native mirror of integration.web.test.ts: drive the public API through
// createTelemetry({ sender }) and assert on what reaches the injected Sender.
// Platform APIs are module-stubbed; nothing reaches into private manager state.
const platform = vi.hoisted(() => ({ OS: "android" }));
vi.mock("react-native", () => ({
  Platform: platform,
  Dimensions: { get: () => ({ width: 390, height: 844 }) },
  PixelRatio: { get: () => 3 },
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
    getSystemName: async () => (platform.OS === "ios" ? "iOS" : "Android"),
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

describe("createTelemetry (native) — credential validation", () => {
  it("accepts a JWT-shaped credential — assertApiKey must not tighten to a segment count (#90)", async () => {
    silenceConsole();
    const { createTelemetry } = await import("./createTelemetry.native");

    // `edge_<jwt>` has fewer than three `_`-parts; the collector's API-key check would reject
    // it, and adopting that check here would make the segmented deployment unreachable.
    expect(() =>
      createTelemetry({
        apiKey: "edge_eyJhbGciOiJSUzI1NiJ9.eyJ0ZW5hbnRfaWQiOiJ0MSJ9.sig",
        endpoint: "https://x/telemetry",
        sender: { send: async () => {} },
      }),
    ).not.toThrow();
  });
});

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
    endpoint: "https://x/telemetry",
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
    expect(Object.keys(a)).not.toContain("device.ios_system_name");   // #108 — omitted off-iOS
    expect(a["network.is_connected"]).toBe(true);
  });

  // device.ios_system_name is the one key with no value off-iOS; assert it carries
  // one when it should, or the respelling is only presence-checked.
  it("ships device.ios_system_name with a value on iOS", async () => {
    silenceConsole();
    platform.OS = "ios";
    try {
      const a = await firstEventAttributes();
      expect(a["device.ios_system_name"]).toBe("iOS");
      expect(Object.keys(a)).not.toContain("device.iosSystemName");
    } finally {
      platform.OS = "android";
    }
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

// #91 — native mirror of the web identity block. Same two keys, same two owners; the
// only difference that matters is that the native Store is asynchronous.
describe("createTelemetry (native) — identity (#91)", () => {
  function build(store: any) {
    const sent: TelemetryEvent[] = [];
    const make = async () => {
      const { createTelemetry } = await import("./createTelemetry.native");
      return createTelemetry({
        apiKey: "edge_integration",
        endpoint: "https://x/telemetry",
        sender: { send: async (e: TelemetryEvent[]) => { sent.push(...e); } },
        batchSize: 50,
        flushIntervalMs: 0,
        captureConsole: false,
        store,
      });
    };
    const last = () => sent[sent.length - 1].attributes!;
    return { make, sent, last };
  }

  async function emit(t: any) {
    await t.log("custom_event");
    await t.flush();
  }

  it("mints a persisted device.id over the async Store and reuses it across restarts", async () => {
    silenceConsole();
    const { memoryStore } = await import("./core/memoryStore");
    const { DEVICE_ID_KEY } = await import("./core/telemetry");
    const store = memoryStore({ async: true });

    const first = build(store);
    await emit(await first.make());
    const id = first.last()["device.id"];
    expect(id).toMatch(/^device_\d+_[0-9a-f]{16}_android$/);
    expect(await store.get(DEVICE_ID_KEY)).toEqual({ status: "hit", value: id });

    const second = build(store);
    await emit(await second.make());
    expect(second.last()["device.id"]).toBe(id);
  });

  it("never rotates device.id — not on identify, not on a user-id change, not on clear", async () => {
    silenceConsole();
    const { memoryStore } = await import("./core/memoryStore");
    const { make, last } = build(memoryStore({ async: true }));
    const t = await make();

    await emit(t);
    const id = last()["device.id"];

    await t.identify({ name: "Ada" });
    await emit(t);
    expect(last()["device.id"]).toBe(id);

    await t.setUserId("cust-88213");
    await emit(t);
    expect(last()["device.id"]).toBe(id);

    await t.clearUserProfile();
    await emit(t);
    expect(last()["device.id"]).toBe(id);
  });

  it("omits user.id until the consumer supplies one, truncating it to 255 at source", async () => {
    silenceConsole();
    const { memoryStore } = await import("./core/memoryStore");
    const { make, last } = build(memoryStore({ async: true }));
    const t = await make();

    await emit(t);
    expect(Object.keys(last())).not.toContain("user.id");

    await t.setUserId("u".repeat(300));
    await emit(t);
    expect(last()["user.id"]).toBe("u".repeat(255));

    await t.clearUserProfile();
    await emit(t);
    expect(Object.keys(last())).not.toContain("user.id");
  });

  it("flags device.id_ephemeral when the Store is unavailable, and omits it otherwise", async () => {
    silenceConsole();
    const { memoryStore } = await import("./core/memoryStore");

    const ok = build(memoryStore({ async: true }));
    await emit(await ok.make());
    expect(Object.keys(ok.last())).not.toContain("device.id_ephemeral");

    const full = build(memoryStore({ async: true, unavailable: true }));
    await emit(await full.make());
    expect(full.last()["device.id_ephemeral"]).toBe(true);
    expect(full.last()["device.id"]).toMatch(/^device_\d+_[0-9a-f]{16}_android$/);
  });
});
