import { it, vi } from "vitest";
import type { TelemetryEvent } from "./core/telemetry";
import { memoryStore } from "./core/memoryStore";
import { dumpRaw } from "./golden.helper";

// The web golden run (#179) — see golden.helper.ts. Owns the `batch-web-*.json` files: the five
// vitals, which only this build sends, and the web variant of what rides around them.

type Cb = (m: any) => void;
const subs: Record<string, Cb[]> = {};
const on = (name: string) => (cb: Cb) => { (subs[name] ??= []).push(cb); };
vi.mock("web-vitals/attribution", () => ({
    onLCP: on("LCP"), onFCP: on("FCP"), onTTFB: on("TTFB"), onCLS: on("CLS"), onINP: on("INP"),
}));
const report = (name: string, m: any) =>
    (subs[name] ?? []).forEach((cb) => cb({ name, rating: "good", navigationType: "navigate", ...m }));

const g = globalThis as any;
const turns = async () => { for (let i = 0; i < 25; i++) await new Promise((r) => setTimeout(r, 0)); };

it("web golden run dumps raw batches", async () => {
    for (const m of ["log", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation(() => {});
    const hide: Array<() => unknown> = [];
    g.document = {
        title: "Golden App", visibilityState: "visible",
        addEventListener: (t: string, cb: any) => { if (t === "visibilitychange") hide.push(cb); },
        removeEventListener: () => {},
    };
    g.window = { location: { hostname: "golden.example.com", pathname: "/" }, addEventListener: () => {}, removeEventListener: () => {} };

    const batches: TelemetryEvent[][] = [];
    const { createTelemetry } = await import("./createTelemetry.web");
    const t = createTelemetry({
        apiKey: "edge_golden", endpoint: "https://collector.example.com/telemetry",
        sender: { send: async (e: TelemetryEvent[]) => { batches.push(e); } },
        store: memoryStore(), batchSize: 500, flushIntervalMs: 0,
    });
    await (t as any).instancePromise;
    await turns();

    report("LCP", { value: 2500, attribution: { target: "img#hero", url: "https://cdn.example.com/hero.jpg", timeToFirstByte: 500, resourceLoadDelay: 100, resourceLoadDuration: 1200, elementRenderDelay: 700 } });
    report("FCP", { value: 1100, attribution: { loadState: "loading" } });
    report("TTFB", { value: 500 });
    report("CLS", { value: 0.08, attribution: { largestShiftTarget: "div.ad", largestShiftValue: 0.05, loadState: "complete" } });
    report("INP", { value: 240, attribution: { interactionTarget: "button#buy", inputDelay: 40, processingDuration: 100, presentationDelay: 100, interactionType: "pointer", loadState: "complete" } });
    g.document.visibilityState = "hidden";
    for (const h of hide) await h();               // the background boundary drains CLS and INP
    await turns();
    await t.flush();

    dumpRaw(batches, "-web");
});
