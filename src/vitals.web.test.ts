import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import type { TelemetryEvent } from "./core/telemetry";

// #106 / §5.3 — the five Core Web Vitals asserted where the contract lives: the
// TelemetryEvent[] that reaches the injected Sender. Names, `type`, keys, values and
// **absence**, since this contract's null discipline is "absent means the SDK had nothing".
//
// `web-vitals/attribution` is module-stubbed rather than driven through a real browser: this
// repo runs vitest under node and has no PerformanceObserver. The stub hands back the metric
// shapes the library documents, so the SDK's half of the contract is what is under test.

type Cb = (m: any) => void;
const subs: Record<string, { cb: Cb; opts?: any }[]> = {};
const on = (name: string) => (cb: Cb, opts?: any) => {
    (subs[name] ??= []).push({ cb, opts });
};

vi.mock("web-vitals/attribution", () => ({
    onLCP: on("LCP"), onFCP: on("FCP"), onTTFB: on("TTFB"),
    onCLS: on("CLS"), onINP: on("INP"),
}));

/** Fire a vital through whatever the tracker subscribed. */
function report(name: string, m: Partial<any>) {
    for (const s of subs[name] ?? []) {
        s.cb({ name, value: 0, rating: "good", navigationType: "navigate", ...m });
    }
}

const g = global as any;
const saved = { document: g.document, window: g.window };

/** Just enough DOM for the lifecycle adapter: the hide edge is the background boundary. */
function installDom() {
    const visibility: Array<() => void> = [];
    g.document = {
        title: "WebApp",
        visibilityState: "visible",
        addEventListener: (type: string, cb: any) => { if (type === "visibilitychange") visibility.push(cb); },
        removeEventListener: () => { },
    };
    g.window = { addEventListener: () => { }, removeEventListener: () => { } };
    return {
        hide: async () => {
            g.document.visibilityState = "hidden";
            for (const h of visibility) await h();
        },
    };
}

function silenceConsole() {
    vi.spyOn(console, "log").mockImplementation(() => { });
    vi.spyOn(console, "warn").mockImplementation(() => { });
    vi.spyOn(console, "error").mockImplementation(() => { });
}

async function harness(extra: Record<string, any> = {}) {
    const { createTelemetry } = await import("./createTelemetry.web");
    const sent: TelemetryEvent[] = [];
    const t = createTelemetry({
        apiKey: "edge_k", endpoint: "https://x/telemetry",
        sender: { send: async (e: TelemetryEvent[]) => { sent.push(...e); } },
        batchSize: 500, flushIntervalMs: 0,
        ...extra,
    });
    await settle(t);
    return { t, sent };
}

/** Let the ctor's fire-and-forget trackers finish their dynamic imports and subscribe. */
async function settle(t: any) {
    await t.instancePromise;
    // Macrotask turns, not just microtasks: the ctor's fire-and-forget trackers each chain
    // several dynamic imports, and `attachAppLifecycle` — the background boundary this file
    // drives — is the last of them to attach. 5 turns was enough on an idle machine and
    // flaked once the suite grew enough workers to contend for them.
    for (let i = 0; i < 25; i++) await new Promise(r => setTimeout(r, 0));
}

const vitals = (sent: TelemetryEvent[], name?: string) =>
    sent.filter(e => e.type === "metric" && (name ? e.metricName === name : ["LCP", "FCP", "CLS", "INP", "TTFB"].includes(e.metricName!)));

let dom: ReturnType<typeof installDom>;
beforeEach(() => {
    for (const k of Object.keys(subs)) delete subs[k];
    silenceConsole();
    dom = installDom();
});
afterEach(() => {
    vi.restoreAllMocks();
    g.document = saved.document;
    g.window = saved.window;
});

describe("web vitals — the metric path (§5.3)", () => {
    it("emits all five on the metric path with metric.unit set, `score` for CLS", async () => {
        const { t, sent } = await harness();

        report("LCP", { value: 2500, attribution: { target: "img#hero", timeToFirstByte: 500, resourceLoadDelay: 100, resourceLoadDuration: 1200, elementRenderDelay: 700 } });
        report("FCP", { value: 1100, attribution: { loadState: "loading" } });
        report("TTFB", { value: 500 });
        report("CLS", { value: 0.08, attribution: { largestShiftTarget: "div.ad", largestShiftValue: 0.05, loadState: "complete" } });
        report("INP", { value: 240, attribution: { interactionTarget: "button#buy", inputDelay: 40, processingDuration: 100, presentationDelay: 100, interactionType: "pointer" } });
        await dom.hide();          // the background boundary drains CLS and INP
        await settle(t);
        await t.flush();

        const byName = Object.fromEntries(vitals(sent).map(e => [e.metricName!, e]));
        expect(Object.keys(byName).sort()).toEqual(["CLS", "FCP", "INP", "LCP", "TTFB"]);
        for (const e of vitals(sent)) expect(e.type).toBe("metric");
        expect(byName.LCP.value).toBe(2500);
        expect(byName.LCP.attributes!["metric.unit"]).toBe("ms");
        expect(byName.TTFB.attributes!["metric.unit"]).toBe("ms");
        expect(byName.CLS.attributes!["metric.unit"]).toBe("score");
    });

    it("ships the four shared attribution keys, and omits target/load_state where there is none", async () => {
        const { t, sent } = await harness();
        report("LCP", { value: 2500, rating: "needs-improvement", navigationType: "back-forward-cache", attribution: { target: "img#hero" } });
        report("TTFB", { value: 500, rating: "good" });
        await settle(t);
        await t.flush();

        const lcp = vitals(sent, "LCP")[0].attributes!;
        expect(lcp["vital.rating"]).toBe("needs-improvement");
        expect(lcp["vital.navigation_type"]).toBe("back-forward-cache");
        expect(lcp["vital.target"]).toBe("img#hero");
        expect("vital.load_state" in lcp).toBe(false);   // LCP has none

        const ttfb = vitals(sent, "TTFB")[0].attributes!;
        expect(ttfb["vital.navigation_type"]).toBe("navigate");   // on every row, always
        expect("vital.target" in ttfb).toBe(false);
    });

    it("LCP's four phase keys sum exactly to value, on the wire", async () => {
        const { t, sent } = await harness();
        report("LCP", { value: 2500, attribution: { timeToFirstByte: 500, resourceLoadDelay: 100, resourceLoadDuration: 1200, elementRenderDelay: 700, url: "https://x/hero.jpg?sig=secret" } });
        await settle(t);
        await t.flush();

        const e = vitals(sent, "LCP")[0];
        const a = e.attributes!;
        expect(a["lcp.time_to_first_byte"] + a["lcp.resource_load_delay"]
            + a["lcp.resource_load_duration"] + a["lcp.element_render_delay"]).toBe(e.value);
        expect(a["lcp.url"]).toBe("https://x/hero.jpg");   // query-stripped
    });

    it("holds CLS and INP as running values and ships them on a closed tab — no manual flush", async () => {
        // The AC's scenario: hide the tab mid-session and never call flush(). Holding the two
        // values and then *not* flushing would move the library's closed-tab defect rather than
        // close it, so the background boundary's own flush is what this asserts.
        const { t, sent } = await harness();

        expect(subs.CLS[0].opts).toEqual({ reportAllChanges: true });
        expect(subs.INP[0].opts).toEqual({ reportAllChanges: true });

        report("CLS", { value: 0.02, attribution: { largestShiftValue: 0.02 } });
        report("CLS", { value: 0.05, attribution: { largestShiftValue: 0.04 } });
        report("CLS", { value: 0.09, attribution: { largestShiftValue: 0.06 } });
        report("INP", { value: 120 });
        report("INP", { value: 240 });
        await settle(t);
        await t.flush();
        expect(vitals(sent, "CLS")).toHaveLength(0);   // nothing yet — a subscription, not a trigger
        expect(vitals(sent, "INP")).toHaveLength(0);

        await dom.hide();
        await settle(t);

        const cls = vitals(sent, "CLS");
        expect(cls).toHaveLength(1);
        expect(cls[0].value).toBe(0.09);               // the latest running value, not the first
        expect(cls[0].attributes!["cls.largest_shift_value"]).toBe(0.06);
        expect(vitals(sent, "INP").map(e => e.value)).toEqual([240]);
    });

    it("does not re-ship a held vital whose value has not moved since the last background", async () => {
        const { t, sent } = await harness();
        report("CLS", { value: 0.09 });
        await dom.hide();
        await settle(t);
        g.document.visibilityState = "visible";
        await dom.hide();          // hidden again, nothing shifted in between
        await settle(t);
        await t.flush();
        expect(vitals(sent, "CLS")).toHaveLength(1);
    });

    it("stamps every vital row with the initial view's view.id (page-load-scoped, §5.3)", async () => {
        const { t, sent } = await harness();
        report("LCP", { value: 2500 });
        report("CLS", { value: 0.09 });
        await settle(t);
        await t.flush();
        const initialView = sent.find(e => e.eventName === "session.started")!.attributes!["view.id"];

        await dom.hide();          // a boundary — the successor view is minted here
        await settle(t);
        await t.flush();

        for (const e of vitals(sent)) expect(e.attributes!["view.id"]).toBe(initialView);
    });

    it("keeps vitals trace-free — Tier 3, all metrics (§6.3)", async () => {
        const { t, sent } = await harness();
        report("LCP", { value: 2500 });
        await settle(t);
        await t.flush();
        const a = vitals(sent, "LCP")[0].attributes!;
        for (const k of ["trace.id", "span.id", "rum.action.id", "trace.root_type"]) {
            expect(k in a).toBe(false);
        }
    });

    it("leaves vital.target reachable by beforeSend — the least sanitized key on the wire", async () => {
        const { t, sent } = await harness({
            beforeSend: (e: TelemetryEvent) => {
                delete e.attributes?.["vital.target"];
                return e;
            },
        });
        report("LCP", { value: 2500, attribution: { target: "img#hero" } });
        await settle(t);
        await t.flush();
        const a = vitals(sent, "LCP")[0].attributes!;
        expect("vital.target" in a).toBe(false);
        expect(a["vital.rating"]).toBe("good");   // the rest of the row survives
    });
});
