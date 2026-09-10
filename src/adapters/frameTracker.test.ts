import { describe, it, expect, vi, afterEach } from "vitest";
import { FrameDropTracker } from "./frameTracker";

// rAF and performance.now are driven by hand: one tick = one frame at `now`.
function harness() {
    let now = 0;
    let frame: (() => void) | undefined;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => { frame = cb; return 1; });

    const metrics: Array<{ name: string; value: number; data: Record<string, any> }> = [];
    let boundary: (() => unknown) | undefined;
    const telemetry = {
        logMetric: async (name: string, value: number, data: Record<string, any> = {}) => {
            metrics.push({ name, value, data });
        },
        views: {
            onBoundary(fn: () => unknown) { boundary = fn; return () => { boundary = undefined; }; },
        },
    };

    return {
        metrics,
        telemetry,
        /** Advance the clock by `ms` and run one rAF callback. */
        tick(ms: number) { now += ms; frame?.(); },
        hitBoundary() { return boundary!(); },
    };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("FrameDropTracker", () => {
    it("emits one frame_render_time per elapsed window, with the measured window length", async () => {
        const h = harness();
        await new FrameDropTracker(h.telemetry, 100).start();

        for (let i = 0; i < 10; i++) h.tick(16);   // 160ms > 100ms window
        await Promise.resolve();

        expect(h.metrics).toHaveLength(1);
        const { name, data } = h.metrics[0];
        expect(name).toBe("frame_render_time");
        expect(data["frame.window_duration_ms"]).toBe(112);   // closes on the first tick past 100ms
        expect(data["frame.target_fps"]).toBe(60);
        expect(data["frame.source"]).toBe("requestAnimationFrame");
    });

    // §5.1 — the reset is the feature: the window closes on the departing view.
    it("flushes the open window at a view boundary and restarts the clock", async () => {
        const h = harness();
        await new FrameDropTracker(h.telemetry, 100000).start();

        h.tick(16); h.tick(16); h.tick(16);
        expect(h.metrics).toHaveLength(0);          // nowhere near the 100s window

        await h.hitBoundary();
        expect(h.metrics).toHaveLength(1);
        expect(h.metrics[0].data["frame.window_duration_ms"]).toBe(48);

        // The next window starts at the boundary, not at the tracker's birth.
        h.tick(16);
        await h.hitBoundary();
        expect(h.metrics).toHaveLength(2);
        expect(h.metrics[1].data["frame.window_duration_ms"]).toBe(16);
    });

    it("emits nothing for an empty window but still resets the clock", async () => {
        const h = harness();
        await new FrameDropTracker(h.telemetry, 100000).start();

        await h.hitBoundary();                       // no frames sampled yet
        expect(h.metrics).toHaveLength(0);

        h.tick(16);
        await h.hitBoundary();
        expect(h.metrics[0].data["frame.window_duration_ms"]).toBe(16);
    });

    it("is idempotent in full: a second start() adds neither a subscription nor a loop", async () => {
        const h = harness();
        const t = new FrameDropTracker(h.telemetry, 100000);
        await t.start();
        await t.start();

        h.tick(16); h.tick(16);
        await h.hitBoundary();
        expect(h.metrics).toHaveLength(1);           // one subscription, not two
        // Two rAF loops would each push a delta per vsync and double the sample count.
        expect(h.metrics[0].data["frame.max_ms"]).toBe(16);
        expect(h.metrics[0].data["frame.window_duration_ms"]).toBe(32);
    });
});
