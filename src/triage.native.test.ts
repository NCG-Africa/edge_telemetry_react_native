import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TelemetryEvent } from "./core/telemetry";
import { memoryStore } from "./core/memoryStore";

// #160 native mirror — the XHR sync-throw root and per-entry trackErrors().

vi.mock("react-native", () => ({
    Platform: { OS: "android" },
    Dimensions: { get: () => ({ width: 390, height: 844 }) },
    PixelRatio: { get: () => 3 },
    AppState: { currentState: "active", addEventListener: () => { } },
}));
vi.mock("react-native-get-random-values", () => ({}));
vi.mock("react-native-device-info", () => ({ default: new Proxy({}, { get: () => async () => "x" }) }));
vi.mock("@react-native-community/netinfo", () => ({
    default: { fetch: async () => ({ type: "wifi", isConnected: true }), addEventListener: () => { } },
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
    default: { getItem: async () => null, setItem: async () => { }, removeItem: async () => { } },
}));

/** A fresh XHR per test: the patch flag rides the constructor, so a shared one stays bound to
 * the first test's instance. `send()` can be made to throw synchronously, as a real one does. */
function makeXHR() {
    function XHR(this: any) { this.status = 200; this._l = {}; }
    XHR.prototype.open = function () { };
    XHR.prototype.send = function (this: any) {
        if (this.throwOnSend) throw new Error("InvalidStateError");
        (this._l.loadend ?? []).forEach((cb: any) => cb());
    };
    XHR.prototype.addEventListener = function (this: any, t: string, cb: any) { (this._l[t] ??= []).push(cb); };
    XHR.prototype.getResponseHeader = () => null;
    XHR.prototype.setRequestHeader = function () { };
    return XHR;
}

const g = global as any;
async function settle() { for (let i = 0; i < 300; i++) await Promise.resolve(); }

beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => { });
    vi.spyOn(console, "warn").mockImplementation(() => { });
    vi.spyOn(console, "error").mockImplementation(() => { });
    vi.stubGlobal("XMLHttpRequest", makeXHR());
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); delete g.ErrorUtils; });

async function launch() {
    const { createTelemetry } = await import("./createTelemetry.native");
    const sent: TelemetryEvent[] = [];
    const t = createTelemetry({
        apiKey: "edge_k", endpoint: "https://collector/telemetry",
        sender: { send: async (e: TelemetryEvent[]) => { sent.push(...e); } },
        store: memoryStore({ async: true }), batchSize: 500, flushIntervalMs: 0,
    });
    await (t as any).instancePromise;
    await settle();
    return { t, sent };
}

describe("#160 native triage", () => {
    it("trackErrors() resolves and attaches the native crash handler", async () => {
        let handler: any;
        g.ErrorUtils = { getGlobalHandler: () => () => { }, setGlobalHandler: (h: any) => { handler = h; } };
        const { t, sent } = await launch();
        await expect(t.trackErrors()).resolves.toBeUndefined();
        handler(new Error("boom"), true);
        await settle();
        await t.flush();
        expect(sent.filter(e => e.eventName === "app.crash").length).toBeGreaterThan(0);
    });

    it("a synchronously-throwing XHR send() leaves no live root behind", async () => {
        const { t, sent } = await launch();
        await t.flush();
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(Date.now() + 60_000);

        const bad = new g.XMLHttpRequest();
        bad.throwOnSend = true;
        bad.open("GET", "https://api.example.com/a");
        expect(() => bad.send()).toThrow();

        const good = new g.XMLHttpRequest();
        good.open("GET", "https://api.example.com/b");
        good.send();
        await settle();
        await t.flush();
        vi.useRealTimers();

        const reqs = sent.filter(e => e.eventName === "http.request").map(e => e.attributes!);
        expect(reqs).toHaveLength(1);
        expect(reqs[0]["trace.root_type"]).toBe("request");
        expect(reqs[0]["parent.span.id"]).toBeUndefined();
    });
});
