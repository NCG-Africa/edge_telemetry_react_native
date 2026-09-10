import { describe, it, expect, vi, afterEach } from "vitest";
import { createTelemetry } from "./createTelemetry.web";
import type { TelemetryEvent } from "./core/telemetry";
import { DEVICE_ID_KEY } from "./core/telemetry";
import { memoryStore } from "./core/memoryStore";
import type { SyncStore } from "./core/store";
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
      endpoint: "https://x/telemetry",
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
    expect(a["device.id"]).toMatch(/^device_\d+_[0-9a-f]{16}_web$/);
  });

  it("never ships standalone device_info/network_info events, even after getDeviceInfo/getNetworkInfo", async () => {
    silenceConsole();
    const sent: TelemetryEvent[] = [];
    const sender = { send: async (e: TelemetryEvent[]) => { sent.push(...e); } };

    const t = createTelemetry({
      apiKey: "edge_integration",
      endpoint: "https://x/telemetry",
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

describe("createTelemetry (web) — Context keys are snake_case on the wire (#88)", () => {
  afterEach(() => vi.unstubAllGlobals());

  async function firstEventAttributes() {
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

// #91 — identity on the wire. Two keys, two owners: `device.id` is SDK-minted and
// persisted, `user.id` is consumer-supplied and absent until it is supplied. Driven
// through the public API and the in-memory Store fake; asserted at the injected Sender.
describe("createTelemetry (web) — identity (#91)", () => {
  async function emit(t: ReturnType<typeof createTelemetry>) {
    await t.log("custom_event");
    await t.flush();
  }

  function build(store?: SyncStore) {
    const sent: TelemetryEvent[] = [];
    const t = createTelemetry({
      apiKey: "edge_integration",
      endpoint: "https://x/telemetry",
      sender: { send: async (e: TelemetryEvent[]) => { sent.push(...e); } },
      batchSize: 50,
      flushIntervalMs: 0,
      captureConsole: false,
      store,
    });
    const last = () => sent[sent.length - 1].attributes!;
    return { t, sent, last };
  }

  it("mints device.id, writes it through the Store, and reuses it across process restarts", async () => {
    silenceConsole();
    const store = memoryStore();

    const first = build(store);
    await emit(first.t);
    const id = first.last()["device.id"];
    expect(id).toMatch(/^device_\d+_[0-9a-f]{16}_web$/);
    expect(store.get(DEVICE_ID_KEY)).toEqual({ status: "hit", value: id });

    // a fresh SDK over the same storage is a process restart
    const second = build(store);
    await emit(second.t);
    expect(second.last()["device.id"]).toBe(id);
  });

  it("suffixes device.id with _web while session.id stays unsuffixed (§3.3)", async () => {
    silenceConsole();
    const { t, last } = build(memoryStore());

    await emit(t);
    expect(last()["device.id"]).toMatch(/^device_\d+_[0-9a-f]{16}_web$/);
    // session.id gains `_web` in v4, not here — it must not follow device.id by accident
    expect(last()["session.id"]).toMatch(/^session_\d+_[0-9a-f]{16}$/);
  });

  it("never rotates device.id — not on identify, not on a user-id change, not on clear", async () => {
    silenceConsole();
    const { t, last } = build(memoryStore());

    await emit(t);
    const id = last()["device.id"];

    await t.identify({ name: "Ada", email: "ada@x.io" });
    await emit(t);
    expect(last()["device.id"]).toBe(id);

    await t.setUserId("cust-88213");
    await emit(t);
    expect(last()["device.id"]).toBe(id);

    await t.setUserId("cust-99999");
    await emit(t);
    expect(last()["device.id"]).toBe(id);

    await t.clearUserProfile();
    await emit(t);
    expect(last()["device.id"]).toBe(id);
  });

  it("omits user.id until the consumer supplies one, then ships it and drops it on clear", async () => {
    silenceConsole();
    const { t, last } = build(memoryStore());

    await emit(t);
    expect(Object.keys(last())).not.toContain("user.id");

    // identify() carries no id of its own — traffic stays anonymous
    await t.identify({ name: "Ada" });
    await emit(t);
    expect(Object.keys(last())).not.toContain("user.id");

    await t.setUserId("cust-88213");
    await emit(t);
    expect(last()["user.id"]).toBe("cust-88213");

    await t.clearUserProfile();
    await emit(t);
    expect(Object.keys(last())).not.toContain("user.id");
  });

  it("truncates a consumer-supplied user.id to 255 chars at source", async () => {
    silenceConsole();
    const { t, last } = build(memoryStore());

    await t.setUserId("u".repeat(300));
    await emit(t);
    expect(last()["user.id"]).toBe("u".repeat(255));

    // the same cap applies through setUserProfile
    await t.setUserProfile({ userId: "v".repeat(300) });
    await emit(t);
    expect(last()["user.id"]).toBe("v".repeat(255));
  });

  it("flags device.id_ephemeral when the Store is unavailable, and omits it otherwise", async () => {
    silenceConsole();

    const ok = build(memoryStore());
    await emit(ok.t);
    expect(Object.keys(ok.last())).not.toContain("device.id_ephemeral");

    const incognito = build(memoryStore({ unavailable: true }));
    await emit(incognito.t);
    expect(incognito.last()["device.id_ephemeral"]).toBe(true);
    expect(incognito.last()["device.id"]).toMatch(/^device_\d+_[0-9a-f]{16}_web$/);
  });
});
