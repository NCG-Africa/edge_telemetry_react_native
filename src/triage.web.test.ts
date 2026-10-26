import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TelemetryEvent } from "./core/telemetry";
import { memoryStore } from "./core/memoryStore";

// #160 — three v4 known gaps, asserted at the createTelemetry({ sender, store }) seam: what
// reaches the Sender, and nothing else.

type Cb = (m: any) => void;
const subs: Record<string, Cb[]> = {};
vi.mock("web-vitals/attribution", () => {
    const on = (name: string) => (cb: Cb) => { (subs[name] ??= []).push(cb); };
    return { onLCP: on("LCP"), onFCP: on("FCP"), onTTFB: on("TTFB"), onCLS: on("CLS"), onINP: on("INP") };
});

const win: any = {};
const doc: any = {};
const handlers: any = {};

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

// One macrotask first: dev defers window.onerror until a boundary can mark (#175).
async function settle() { await new Promise((r) => setTimeout(r, 0)); for (let i = 0; i < 300; i++) await Promise.resolve(); }

beforeEach(() => {
    for (const k of Object.keys(subs)) delete subs[k];
    vi.spyOn(console, "log").mockImplementation(() => { });
    vi.spyOn(console, "warn").mockImplementation(() => { });
    vi.spyOn(console, "error").mockImplementation(() => { });
    win.addEventListener = () => { };
    Object.defineProperty(win, "onerror", { set(h) { handlers.onerror = h; }, configurable: true });
    Object.defineProperty(win, "onunhandledrejection", { set(h) { handlers.rejection = h; }, configurable: true });
    win.fetch = vi.fn(async () => ({ status: 200, headers: { get: () => null } }));
    doc._l = {} as Record<string, any[]>;
    doc.visibilityState = "visible";
    doc.addEventListener = (t: string, fn: any) => { (doc._l[t] ??= []).push(fn); };
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", doc);
    vi.stubGlobal("XMLHttpRequest", makeXHR());
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function launch() {
    const { createTelemetry } = await import("./createTelemetry.web");
    const cls = subs.CLS?.length ?? 0;
    const sent: TelemetryEvent[] = [];
    const t = createTelemetry({
        apiKey: "edge_k", endpoint: "https://collector/telemetry",
        sender: { send: async (e: TelemetryEvent[]) => { sent.push(...e); } },
        store: memoryStore(), batchSize: 500, flushIntervalMs: 0,
    });
    await (t as any).instancePromise;
    await settle();
    await vi.waitFor(() => expect(subs.CLS?.length).toBeGreaterThan(cls));
    // Macrotask turns: the lifecycle listener is the last of the ctor's dynamic-import chains to
    // attach, and the click tracker registers a `visibilitychange` listener of its own first.
    for (let i = 0; i < 25; i++) await new Promise(r => setTimeout(r, 0));
    return { t, sent };
}

async function hide() {
    doc.visibilityState = "hidden";
    for (const fn of doc._l.visibilitychange ?? []) await fn({});
    await settle();
    await new Promise(r => setTimeout(r, 20));
}

describe("#160 web triage", () => {
    it("after shutdown(), a background boundary emits no CLS/INP row", async () => {
        const { t, sent } = await launch();
        subs.CLS.forEach(cb => cb({ name: "CLS", value: 0.2, rating: "poor", navigationType: "navigate" }));
        await t.shutdown();
        await hide();
        await t.flush();
        expect(sent.filter(e => e.metricName === "CLS" || e.metricName === "INP")).toEqual([]);
        // Control: without shutdown() the same boundary does ship the held value.
        doc.visibilityState = "visible";
        const control = await launch();
        subs.CLS[subs.CLS.length - 1]({ name: "CLS", value: 0.2, rating: "poor", navigationType: "navigate" });
        await hide();
        await control.t.flush();
        expect(control.sent.filter(e => e.metricName === "CLS")).toHaveLength(1);
    });

    it("trackErrors() resolves and captures — the web handler, not the native one", async () => {
        const { t, sent } = await launch();
        await expect(t.trackErrors()).resolves.toBeUndefined();
        handlers.onerror("boom", "", 0, 0, new Error("boom"));
        await settle();
        await t.flush();
        expect(sent.filter(e => e.eventName === "app.crash")).toHaveLength(1);
    });

    it("a synchronously-throwing XHR send() leaves no live root behind", async () => {
        const { t, sent } = await launch();
        await t.flush();
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(Date.now() + 60_000);   // launch root long expired

        const bad = new (XMLHttpRequest as any)();
        bad.throwOnSend = true;
        bad.open("GET", "https://api.example.com/a");
        expect(() => bad.send()).toThrow();

        const good = new (XMLHttpRequest as any)();
        good.open("GET", "https://api.example.com/b");
        good.send();
        await settle();
        await t.flush();
        vi.useRealTimers();

        const reqs = sent.filter(e => e.eventName === "http.request").map(e => e.attributes!);
        expect(reqs).toHaveLength(1);
        // Its own root — not a child of the failed send's orphan.
        expect(reqs[0]["trace.root_type"]).toBe("request");
        expect(reqs[0]["parent.span.id"]).toBeUndefined();
        expect(reqs[0]["rum.action.id"]).toBe(reqs[0]["span.id"]);
    });
});
