import { it, expect, vi } from "vitest";
import type { TelemetryEvent } from "./core/telemetry";
import { memoryStore } from "./core/memoryStore";
import { goldens, syncGoldens } from "./golden.helper";

// The native golden run (#179) — see golden.helper.ts. One session that reaches every catalogue
// event the native build sends, through the public API and stubbed platform modules.

const rn = vi.hoisted(() => ({
    state: "active",
    app: [] as Array<(s: string) => void>,
    net: [] as Array<(s: any) => void>,
}));
vi.mock("react-native", () => ({
    Platform: { OS: "android" },
    Dimensions: { get: () => ({ width: 390, height: 844 }) },
    PixelRatio: { get: () => 3, getFontScale: () => 1 },
    AccessibilityInfo: { isReduceMotionEnabled: async () => false, isScreenReaderEnabled: async () => false },
    AppState: {
        get currentState() { return rn.state; },
        addEventListener: (_t: string, fn: (s: string) => void) => { rn.app.push(fn); },
    },
}));
vi.mock("react-native-get-random-values", () => ({}));
vi.mock("react-native-device-info", () => ({
    default: {
        getApplicationName: async () => "Golden App", getVersion: async () => "1.0.0",
        getBuildNumber: async () => "1", getBundleId: async () => "com.example.golden",
        getBrand: async () => "google", getManufacturer: async () => "Google",
        getModel: async () => "Pixel 8", getSystemVersion: async () => "14",
        getSystemName: async () => "Android", getApiLevel: async () => 34,
        supportedAbis: async () => ["arm64-v8a"], isLowRamDevice: async () => false,
        getUsedMemory: async () => 128 * 1024 * 1024, getTotalMemory: async () => 4096 * 1024 * 1024,
        getBatteryLevel: async () => 0.5, isBatteryCharging: async () => true,
        getPowerState: async () => ({ lowPowerMode: false }),
    },
}));
vi.mock("@react-native-community/netinfo", () => ({
    default: {
        fetch: async () => ({ type: "wifi", isConnected: true }),
        addEventListener: (fn: (s: any) => void) => { rn.net.push(fn); return () => {}; },
    },
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
    default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

const g = globalThis as any;
let mono = 0;

async function settle() {
    for (let pass = 0; pass < 5; pass++) {
        for (let i = 0; i < 100; i++) await Promise.resolve();
        await vi.advanceTimersByTimeAsync(0);
    }
}

/** XHR double + the whatwg-fetch wrapper RN builds on it. */
function installHttp() {
    function XHR(this: any) { this.status = 200; this._l = {}; }
    XHR.prototype.open = function () {};
    XHR.prototype.send = function (this: any) { (this._l.loadend || []).forEach((cb: any) => cb()); };
    XHR.prototype.addEventListener = function (this: any, t: string, cb: any) { (this._l[t] ??= []).push(cb); };
    XHR.prototype.getResponseHeader = (k: string) => (k.toLowerCase() === "content-length" ? "34" : null);
    g.XMLHttpRequest = XHR;
    g.fetch = async (url: string, init?: any) => {
        const x = new g.XMLHttpRequest();
        x.open(init?.method ?? "GET", url);
        x.send(init?.body);
        return { status: x.status };
    };
}

it("native goldens match the wire", async () => {
    for (const m of ["log", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation(() => {});
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    vi.spyOn(performance, "now").mockImplementation(() => mono);
    (performance as any).rnStartupTiming = { startTime: 1, endTime: 400, executeJavaScriptBundleEntryPointEnd: 200 };
    let raf: (() => void) | undefined;
    vi.stubGlobal("requestAnimationFrame", (fn: () => void) => { raf = fn; return 1; });
    let crash: ((e: unknown, fatal?: boolean) => void) | undefined;
    g.ErrorUtils = { setGlobalHandler: (h: any) => { crash = h; }, getGlobalHandler: () => undefined };
    g.__DEV__ = false;
    installHttp();

    const batches: TelemetryEvent[][] = [];
    const { createTelemetry } = await import("./createTelemetry.native");
    const t = createTelemetry({
        apiKey: "edge_golden", endpoint: "https://collector.example.com/telemetry",
        sender: { send: async (e: TelemetryEvent[]) => { batches.push(e); } },
        store: memoryStore(), batchSize: 500, flushIntervalMs: 0, buildId: "golden-build",
    });
    await settle();
    await vi.advanceTimersByTimeAsync(1000);   // app.start polls rnStartupTiming.endTime
    await settle();

    const frames = (n: number, ms: number) => { for (let i = 0; i < n; i++) { mono += ms; raf?.(); } };
    frames(30, 16.7);

    await t.screenStart("Home");
    await t.identify({ userId: "u_1", name: "Ada", email: "ada@example.com", phone: "+254700000000" });
    await t.log("checkout_started");
    await t.recordMetric("cart_value", 12.5, {}, { unit: "KES" });
    await t.trackTap("pay");
    await g.fetch("https://api.example.com/v1/orders/42", { method: "post", body: "{}" });
    t.startSpan("pay").end({ outcome: "failed", reason: "card_declined" });
    t.startSpan("load").end();
    await t.captureError(new Error("handled"));
    crash!(new Error("unhandled"), true);
    await settle();

    // A 3 s JS-thread stall between two hang-detector ticks.
    mono += 1000; await vi.advanceTimersByTimeAsync(1000); await settle();
    mono += 4000; vi.setSystemTime(Date.now() + 3000); await vi.advanceTimersByTimeAsync(1000); await settle();

    for (const fn of rn.net) fn({ type: "cellular", isConnected: true });
    frames(30, 16.7);
    await t.screenStart("Checkout");                       // view + screen.load for Home
    rn.state = "background";
    for (const fn of rn.app) await fn("background");       // app.lifecycle, view, frame.summary
    await settle();
    rn.state = "active";
    for (const fn of rn.app) await fn("active");
    await settle();
    await t.startNewSession();                             // session.finalized + session.started
    await settle();
    await t.flush();
    await settle();

    const fresh = goldens(batches);
    const owns = (f: string) => !f.endsWith("-web.json");
    expect(fresh).toEqual(syncGoldens(fresh, owns));
    vi.useRealTimers();
});
