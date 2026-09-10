import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TraceManager } from "./traceManager";

// #98 — the expiry clock and the root/child key identity, unit-tested here because both are
// pure bookkeeping over `Date.now()`. The wire-level assertions (which events carry which
// tier) live in the integration mirrors, where the seam is the injected Sender.

const at = (iso: string) => vi.setSystemTime(new Date(iso));

beforeEach(() => {
    vi.useFakeTimers();
    at("2026-06-14T10:00:00.000Z");
});
afterEach(() => vi.useRealTimers());

describe("#98 root identity", () => {
    it("mints a launch root at construction and reports it as a root", () => {
        const t = new TraceManager();
        const a = t.launchRootAttributes();
        expect(a["trace.id"]).toMatch(/^[0-9a-f]{32}$/);
        expect(a["span.id"]).toMatch(/^[0-9a-f]{16}$/);
        expect(a["rum.action.id"]).toBe(a["span.id"]);   // §6.1: equal on a root
        expect(a["parent.span.id"]).toBeUndefined();     // omitted on roots
        expect(a["trace.root_type"]).toBe("launch");
        expect(a["span.start_time"]).toBe("2026-06-14T10:00:00.000Z");
        expect(a["span.duration_ms"]).toBeUndefined();   // roots derive it server-side
    });

    it("reports the caller's launch start, not the mint time (web's timeOrigin)", () => {
        const t = new TraceManager(Date.now() - 1500);
        expect(t.launchRootAttributes()["span.start_time"]).toBe("2026-06-14T09:59:58.500Z");
    });

    it("a child carries parent.span.id and rum.action.id equal to it", () => {
        const t = new TraceManager();
        const child = t.viewSpan(Date.now());
        const launch = t.launchRootAttributes();
        expect(child["trace.id"]).toBe(launch["trace.id"]);
        expect(child["parent.span.id"]).toBe(launch["span.id"]);
        expect(child["rum.action.id"]).toBe(child["parent.span.id"]);   // §6.1: equal on a child
        expect(child["span.id"]).not.toBe(child["parent.span.id"]);
        expect(child["trace.root_type"]).toBe("launch");                // denormalized onto children
    });
});

describe("#98 minting when no root is live", () => {
    it("a view with no live root mints a navigation root", () => {
        const t = new TraceManager();
        t.clear();
        const v = t.viewSpan(Date.now());
        expect(v["trace.root_type"]).toBe("navigation");
        expect(v["rum.action.id"]).toBe(v["span.id"]);
        expect(v["parent.span.id"]).toBeUndefined();
    });

    it("a request with no live root mints a request root and reports no duration", () => {
        const t = new TraceManager();
        t.clear();
        const finish = t.requestSpan(Date.now());
        const r = finish(Date.now() + 250);
        expect(r["trace.root_type"]).toBe("request");
        expect(r["rum.action.id"]).toBe(r["span.id"]);
        expect(r["span.duration_ms"]).toBeUndefined();
    });

    it("a request under a live root is a child and does carry span.duration_ms", () => {
        const t = new TraceManager();
        const r = t.requestSpan(Date.now())(Date.now() + 250);
        expect(r["trace.root_type"]).toBe("launch");
        expect(r["parent.span.id"]).toBe(t.launchRootAttributes()["span.id"]);
        expect(r["span.duration_ms"]).toBe(250);
    });
});

describe("#98 expiry — 2 s idle / 10 s cap, internal constants", () => {
    it("holds the root at exactly 2 s idle and drops it just past", () => {
        const t = new TraceManager();
        vi.advanceTimersByTime(2000);
        expect(t.viewSpan(Date.now())["trace.root_type"]).toBe("launch");

        vi.advanceTimersByTime(2001);
        expect(t.viewSpan(Date.now())["trace.root_type"]).toBe("navigation");
    });

    it("a span start extends the root, so 3 x 1.5 s of activity keeps one trace", () => {
        const t = new TraceManager();
        const id = t.launchRootAttributes()["trace.id"];
        for (let i = 0; i < 3; i++) {
            vi.advanceTimersByTime(1500);
            expect(t.viewSpan(Date.now())["trace.id"]).toBe(id);
        }
    });

    it("the 10 s cap ends the root even under continuous activity", () => {
        const t = new TraceManager();
        const id = t.launchRootAttributes()["trace.id"];
        let last = id;
        for (let i = 0; i < 10; i++) {
            vi.advanceTimersByTime(1500);
            last = t.viewSpan(Date.now())["trace.id"] as string;
        }
        expect(last).not.toBe(id);
    });

    it("a backwards clock is clamped to expired, not read as fresh", () => {
        const t = new TraceManager();
        const now = Date.now();
        expect(t.viewSpan(now - 60_000)["trace.root_type"]).toBe("navigation");
    });
});

describe("#98 Tier 2 annotation", () => {
    it("carries the trace without occupying a span", () => {
        const t = new TraceManager();
        const a = t.annotate(Date.now());
        expect(a["trace.id"]).toBe(t.launchRootAttributes()["trace.id"]);
        expect(a["rum.action.id"]).toBe(t.launchRootAttributes()["span.id"]);
        expect(a["trace.root_type"]).toBe("launch");
        expect(a["span.id"]).toBeUndefined();
        expect(a["parent.span.id"]).toBeUndefined();
        expect(a["span.start_time"]).toBeUndefined();
    });

    it("never mints: with no live root it carries nothing at all", () => {
        const t = new TraceManager();
        t.clear();
        expect(t.annotate(Date.now())).toEqual({});
        // and it did not leave a root behind for the next caller to join
        expect(t.viewSpan(Date.now())["trace.root_type"]).toBe("navigation");
    });

    it("does not extend the root — annotating for 3 s still lets it expire", () => {
        const t = new TraceManager();
        vi.advanceTimersByTime(1500);
        expect(t.annotate(Date.now())["trace.root_type"]).toBe("launch");
        vi.advanceTimersByTime(1500);
        expect(t.annotate(Date.now())).toEqual({});
    });
});
