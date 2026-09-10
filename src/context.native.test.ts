import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TelemetryEvent } from "./core/telemetry";
import { memoryStore } from "./core/memoryStore";

// #108 — the native mirror of context.web.test.ts. Same seam: the public API in,
// the injected Sender out. Platform APIs are module-stubbed; nothing reaches into a
// manager's private state.

const platform = vi.hoisted(() => ({ OS: "android" }));
const appState = vi.hoisted(() => ({ currentState: "active", addEventListener: () => {} }));

vi.mock("react-native", () => ({
  Platform: platform,
  AppState: appState,
  Dimensions: { get: () => ({ width: 390, height: 844 }) },
  PixelRatio: { get: () => 3 },
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
    getSystemName: async () => (platform.OS === "ios" ? "iOS" : "Android"),
    getApiLevel: async () => 34,
    getHardware: async () => "hw",
    getProduct: async () => "prod",
    supportedAbis: async () => ["arm64-v8a", "armeabi-v7a"],
    isLowRamDevice: async () => false,
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

/** §3.3's native (Android) column. */
const NATIVE_PRESENT = [
  "session.id", "session.start_time", "session.sequence", "session.sample_rate",
  "event.sequence",
  "sdk.platform", "sdk.version", "sdk.events_dropped", "sdk.hook_dropped", "sdk.hook_failed",
  "app.name", "app.version", "app.build_number", "app.package_name",
  "device.id", "device.platform", "device.platform_version", "device.model",
  "device.manufacturer", "device.brand",
  "device.android_sdk", "device.android_release", "device.hardware", "device.product",
  "device.cpu_abi", "device.low_ram",
  "device.screen_density", "device.screen_width_px", "device.screen_height_px",
  "device.orientation",
  "network.type", "network.is_connected",
  "view.id", "view.name",
];

const NATIVE_OMITTED = [
  "user.id", "app.build_id", "device.id_ephemeral", "sdk.drop_reason",
  "device.ios_system_name",   // off-iOS
];

async function build(opts: Record<string, any> = {}) {
  const { createTelemetry } = await import("./createTelemetry.native");
  const sent: TelemetryEvent[] = [];
  const t = createTelemetry({
    apiKey: "edge_ctx",
    endpoint: "https://x/telemetry",
    sender: { send: async (e: TelemetryEvent[]) => { sent.push(...e); } },
    batchSize: 50,
    flushIntervalMs: 0,
    captureConsole: false,
    store: memoryStore({ async: true }),
    ...opts,
  });
  return { t, sent, attrs: (name: string) => sent.find((e) => e.eventName === name)!.attributes! };
}

describe("#108 the Context block — native", () => {
  beforeEach(() => silenceConsole());
  afterEach(() => { platform.OS = "android"; vi.restoreAllMocks(); });

  it("carries exactly §3.3's native key set, and nothing else", async () => {
    const { t, attrs } = await build();
    await t.log("custom_event");
    await t.flush();

    const keys = Object.keys(attrs("custom_event"));
    for (const k of NATIVE_PRESENT) expect(keys).toContain(k);
    for (const k of NATIVE_OMITTED) expect(keys).not.toContain(k);
    expect(keys.filter((k) => !NATIVE_PRESENT.includes(k)).sort())
      .toEqual(["rum.action.id", "trace.id", "trace.root_type"]);
    // 34 present + 5 omitted = §3.3's 39, and the web mirror asserts the other split.
    expect(NATIVE_PRESENT.length + NATIVE_OMITTED.length).toBe(39);
  });

  it("ships sdk.platform as react-native-{Platform.OS} on both native OSes", async () => {
    const android = await build();
    await android.t.log("custom_event");
    await android.t.flush();
    expect(android.attrs("custom_event")["sdk.platform"]).toBe("react-native-android");

    platform.OS = "ios";
    const ios = await build();
    await ios.t.log("custom_event");
    await ios.t.flush();
    expect(ios.attrs("custom_event")["sdk.platform"]).toBe("react-native-ios");
    // and the iOS key appears exactly where the Android ones drop out
    expect(Object.keys(ios.attrs("custom_event"))).toContain("device.ios_system_name");
    expect(Object.keys(ios.attrs("custom_event"))).not.toContain("device.android_sdk");
  });

  it("populates the capability and viewport keys (§3.3 ✱)", async () => {
    const { t, attrs } = await build();
    await t.log("custom_event");
    await t.flush();
    const a = attrs("custom_event");
    expect(a["device.cpu_abi"]).toBe("arm64-v8a");
    expect(a["device.low_ram"]).toBe(false);
    expect(a["device.screen_density"]).toBe(3);
    expect(a["device.screen_width_px"]).toBe(1170);
    expect(a["device.screen_height_px"]).toBe(2532);
    expect(a["device.orientation"]).toBe("portrait");
  });

  it("ships none of §3.4's deleted keys", async () => {
    const { t, attrs } = await build();
    await t.identify({ userId: "u1", name: "Ada", email: "ada@x.io" });
    await t.log("custom_event");
    await t.flush();

    for (const k of [
      "device.fingerprint", "device.iosDeviceName",
      "user.fullName", "user.firstName", "user.lastName",
      "user.avatar", "user.createdAt", "user.updatedAt",
      "user.name", "user.email", "user.phone",
    ]) expect(Object.keys(attrs("custom_event"))).not.toContain(k);

    expect(attrs("custom_event")["user.id"]).toBe("u1");
  });

  it("suffixes session.id with the OS on native too (§3.3 / §12's item 13)", async () => {
    const { t, attrs } = await build();
    await t.log("custom_event");
    await t.flush();
    expect(attrs("custom_event")["session.id"]).toMatch(/^session_\d+_[0-9a-f]{16}_android$/);
    expect(attrs("custom_event")["device.id"]).toMatch(/^device_\d+_[0-9a-f]{16}_android$/);
  });
});

// §3.1 — attribution freezes at span start. `http.request` is the case that matters:
// §4.2's 4-hour cap can rotate a session while a request is in flight, which would
// otherwise put S1's trace on an S2 row and break the invariant §6.6 lets you assert.
const g = global as any;
const savedXhr = { XMLHttpRequest: g.XMLHttpRequest };

/**
 * An XHR double whose response lands when the test says so — the point of the freeze is
 * the gap between `send()` and `loadend`, which the eager doubles elsewhere collapse.
 */
function installDeferredXhr() {
  const pending: Array<() => void> = [];
  function XHR(this: any) { this.status = 0; this._l = {}; }
  XHR.prototype.open = function () {};
  XHR.prototype.send = function (this: any) {
    pending.push(() => { this.status = 200; (this._l["loadend"] || []).forEach((cb: any) => cb()); });
  };
  XHR.prototype.addEventListener = function (this: any, t: string, cb: any) {
    (this._l[t] = this._l[t] || []).push(cb);
  };
  XHR.prototype.getResponseHeader = () => null;
  g.XMLHttpRequest = XHR;
  return () => { for (const done of pending.splice(0)) done(); };
}

/** Move the wall clock without touching timers — the ctor's dynamic imports need those. */
function shiftClock() {
  const real = Date.now;
  const state = { ms: 0 };
  vi.spyOn(Date, "now").mockImplementation(() => real.call(Date) + state.ms);
  return (ms: number) => { state.ms = ms; };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("#108 the attribution freeze (§3.1) — native", () => {
  beforeEach(() => silenceConsole());
  afterEach(() => { g.XMLHttpRequest = savedXhr.XMLHttpRequest; vi.restoreAllMocks(); });

  async function launch() {
    const settle = installDeferredXhr();
    const built = await build();
    await built.t.flush();
    await tick();                     // the ctor patches XHR behind a dynamic import
    const inst = await (built.t as any).instancePromise;
    return { ...built, inst, settle };
  }

  it("an http.request that outlives a session rotation carries the frozen session.id", async () => {
    const advance = shiftClock();
    const { t, sent, attrs, inst, settle } = await launch();
    const before = inst.getSessionId();
    const startTime = attrs("session.started")["session.start_time"];

    const xhr = new g.XMLHttpRequest();
    xhr.open("GET", "https://api.example.com/v1/orders");
    xhr.send();

    // Four hours later — §4.2's maximum-length cap — the response lands.
    advance(4 * 60 * 60 * 1000 + 1000);
    await t.log("custom_event");      // trips the lazy rotation check
    expect(inst.getSessionId()).not.toBe(before);

    settle();
    await tick();
    await t.flush();

    const req = sent.find((e) => e.eventName === "http.request")!;
    expect(req.attributes!["session.id"]).toBe(before);
    // `session.start_time` freezes with the id it belongs to, or the pair disagrees
    expect(req.attributes!["session.start_time"]).toBe(startTime);
  });

  it("resolves view.name at log time by lookup on the frozen view.id", async () => {
    const { t, sent, inst, settle } = await launch();
    await inst.enterView("Cart", "route");
    const frozen = inst.views.id;

    const xhr = new g.XMLHttpRequest();
    xhr.open("GET", "https://api.example.com/v1/cart");
    xhr.send();

    // A rung **upgrade**: same `view.id`, better name. The row follows the name, because
    // the id it is pinned to never moved (§4.5.1).
    await inst.enterView("Shopping cart", "explicit");
    expect(inst.views.id).toBe(frozen);

    settle();
    await tick();
    await t.flush();

    const req = sent.find((e) => e.eventName === "http.request")!;
    expect(req.attributes!["view.id"]).toBe(frozen);
    expect(req.attributes!["view.name"]).toBe("Shopping cart");
  });

  it("keeps the departing view.id when a route change lands mid-request", async () => {
    const { t, sent, inst, settle } = await launch();
    await inst.enterView("Cart", "route");
    const frozen = inst.views.id;

    const xhr = new g.XMLHttpRequest();
    xhr.open("GET", "https://api.example.com/v1/cart");
    xhr.send();

    await inst.enterView("Checkout", "route");   // same rung, new name — a real navigation
    expect(inst.views.id).not.toBe(frozen);

    settle();
    await tick();
    await t.flush();

    const req = sent.find((e) => e.eventName === "http.request")!;
    expect(req.attributes!["view.id"]).toBe(frozen);
    // the retired view's final name, looked up on the frozen id — not the arriving one
    expect(req.attributes!["view.name"]).toBe("Cart");
  });
});
