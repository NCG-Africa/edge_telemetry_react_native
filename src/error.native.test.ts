import { describe, it, expect, vi, afterEach } from "vitest";
import type { TelemetryEvent } from "./core/telemetry";

// #100 / §4.7 native mirror of error.web.test.ts. Platform APIs are module-stubbed; the
// assertions are on the TelemetryEvent[] that reaches the injected Sender.
const platform = vi.hoisted(() => ({ OS: "android" }));
vi.mock("react-native", () => ({
  Platform: platform,
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
    getDeviceName: async () => "Pixel 8",
    getApiLevel: async () => 34,
    getFingerprint: async () => "google/panther",
    getHardware: async () => "panther",
    getProduct: async () => "panther",
  },
}));

vi.mock("@react-native-community/netinfo", () => ({
  default: { fetch: async () => ({ type: "wifi", isConnected: true }), addEventListener: () => {} },
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

const g = global as any;
afterEach(() => { delete g.ErrorUtils; vi.restoreAllMocks(); });

function silenceConsole() {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
}

async function harness(extra: Record<string, any> = {}) {
  const { createTelemetry } = await import("./createTelemetry.native");
  const sent: TelemetryEvent[] = [];
  const t = createTelemetry({
    apiKey: "edge_k", endpoint: "https://x/telemetry",
    sender: { send: async (e: TelemetryEvent[]) => { sent.push(...e); } },
    batchSize: 500, flushIntervalMs: 0,
    ...extra,
  });
  return { t, sent };
}

/** Let the ctor's fire-and-forget trackErrors() finish its dynamic import and attach. */
async function settle(t: any) {
  await (t as any).instancePromise;
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe("app.crash on native — error.fatal and the breadcrumb trail (§4.7)", () => {
  it("ships error.fatal and a stringified error.breadcrumbs from the global handler", async () => {
    silenceConsole();
    let handler: ((e: any, fatal?: boolean) => void) | undefined;
    g.ErrorUtils = { setGlobalHandler: (h: any) => { handler = h; }, getGlobalHandler: () => undefined };

    const { t, sent } = await harness();
    await settle(t);
    await t.log("navigation");

    handler!(new Error("boom"), true);
    await settle(t);
    await t.flush();

    const a = sent.find((e) => e.eventName === "app.crash")!.attributes!;
    expect(a["error.source"]).toBe("global_handler");
    expect(a["error.fatal"]).toBe(true);          // native-only; the web build omits it

    // A stringified JSON array, not a real one: `stringAttr` renders non-scalars through
    // `fmt.Sprint`, which would arrive as Go map syntax (§4.7).
    expect(typeof a["error.breadcrumbs"]).toBe("string");
    const trail = JSON.parse(a["error.breadcrumbs"]);
    expect(Array.isArray(trail)).toBe(true);
    expect(trail.map((b: any) => b.name)).toContain("navigation");
    expect(trail.map((b: any) => b.name)).not.toContain("app.crash");

    expect(Object.keys(a).some((k) => k.startsWith("crash."))).toBe(false);
  });

  it("demotes a console.warn to a breadcrumb — it is never an error (§4.7)", async () => {
    silenceConsole();
    let handler: ((e: any, fatal?: boolean) => void) | undefined;
    g.ErrorUtils = { setGlobalHandler: (h: any) => { handler = h; }, getGlobalHandler: () => undefined };

    const { createTelemetry } = await import("./createTelemetry.native");
    const sent: TelemetryEvent[] = [];
    const t = createTelemetry({
      apiKey: "edge_k", endpoint: "https://x/telemetry",
      sender: { send: async (e: TelemetryEvent[]) => { sent.push(...e); } },
      batchSize: 500, flushIntervalMs: 0,
      captureConsole: true,                 // opt in: the default is off
    });
    await settle(t);

    console.warn("Each child in a list should have a unique key prop.");
    handler!(new Error("boom"), false);
    await settle(t);
    await t.flush();

    // The warning produced no event of its own...
    expect(sent.filter((e) => e.eventName === "app.error")).toHaveLength(0);
    // ...but it is on the crash's trail.
    const trail = JSON.parse(sent.find((e) => e.eventName === "app.crash")!.attributes!["error.breadcrumbs"]);
    expect(trail.some((b: any) => b.name === "console.warn")).toBe(true);
  });

  it("routes an opted-in console.error to app.error, never app.crash", async () => {
    silenceConsole();
    g.ErrorUtils = { setGlobalHandler: () => {}, getGlobalHandler: () => undefined };

    const { createTelemetry } = await import("./createTelemetry.native");
    const sent: TelemetryEvent[] = [];
    const t = createTelemetry({
      apiKey: "edge_k", endpoint: "https://x/telemetry",
      sender: { send: async (e: TelemetryEvent[]) => { sent.push(...e); } },
      batchSize: 500, flushIntervalMs: 0,
      captureConsole: true,
    });
    await settle(t);

    console.error("something went wrong");
    await settle(t);
    await t.flush();

    const err = sent.find((e) => e.eventName === "app.error")!;
    expect(err.attributes!["error.source"]).toBe("console");
    expect(err.attributes!["error.fatal"]).toBe(false);
    expect(sent.some((e) => e.eventName === "app.crash")).toBe(false);
    expect("error.breadcrumbs" in err.attributes!).toBe(false);
  });
});

describe("captureError on native (§4.7)", () => {
  it("emits app.error from an unknown that is neither an Error nor a string", async () => {
    silenceConsole();
    const { t, sent } = await harness();
    await settle(t);

    await t.captureError({ status: 500, message: "gateway" });
    await t.flush();

    const err = sent.find((e) => e.eventName === "app.error")!.attributes!;
    expect(err["error.source"]).toBe("reported");
    expect(err["error.type"]).toBe("Error");
    expect(err["error.message"]).toBe("gateway");
    // error.fatal is native-only and nothing reported is fatal — so `false`, not omitted.
    // The web build omits the key entirely (see error.web.test.ts).
    expect(err["error.fatal"]).toBe(false);
    expect(sent.some((e) => e.eventName === "app.crash")).toBe(false);
  });
});

describe("app.build_id and the stackTraceLimit advisory on native (§4.8)", () => {
  it("ships app.build_id on every row when set, and omits it when unset", async () => {
    silenceConsole();
    const withId = await harness({ buildId: "ci-4471" });
    await settle(withId.t);
    await withId.t.captureError(new Error("boom"));
    await withId.t.flush();
    expect(withId.sent.every((e) => e.attributes!["app.build_id"] === "ci-4471")).toBe(true);

    const without = await harness();
    await settle(without.t);
    await without.t.captureError(new Error("boom"));
    await without.t.flush();
    const a = without.sent.find((e) => e.eventName === "app.error")!.attributes!;
    expect("app.build_id" in a).toBe(false);
    // Present and deliberately unused: no fallback to version + build_number, ever.
    expect(a["app.version"]).toBe("2.3.4");
    expect(a["app.build_number"]).toBe("77");
  });

  it("never assigns Error.stackTraceLimit — driving the public API end to end", async () => {
    silenceConsole();
    const before = Error.stackTraceLimit;
    let assigned = false;
    Object.defineProperty(Error, "stackTraceLimit", {
      configurable: true,
      get: () => before,
      set: () => { assigned = true; },
    });

    try {
      let handler: ((e: any, fatal?: boolean) => void) | undefined;
      g.ErrorUtils = { setGlobalHandler: (h: any) => { handler = h; }, getGlobalHandler: () => undefined };

      const { t } = await harness();
      await settle(t);
      handler!(new Error("boom"), true);
      await t.captureError(new Error("handled"));
      await t.flush();

      expect(assigned).toBe(false);
    } finally {
      Object.defineProperty(Error, "stackTraceLimit", { configurable: true, writable: true, value: before });
    }
  });
});
