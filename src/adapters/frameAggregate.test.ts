import { describe, it, expect } from "vitest";
import { aggregateFrames } from "./frameAggregate";

// `frame.summary` (#179, catalogue frames_memory.yaml): one frame window, classified SDK-side.
describe("aggregateFrames — the frame.summary window", () => {
    it("counts total, slow and frozen frames and carries max/p95 for a 60 Hz window", () => {
        // 16ms budget → slow threshold 33.3ms. Two frames (40, 60) exceed it; none reach 700.
        const deltas = [16, 16, 16, 16, 16, 16, 16, 16, 40, 60];
        const a = aggregateFrames(deltas, 10000, "requestAnimationFrame");

        expect(a["frame.total_frames"]).toBe(10);
        expect(a["frame.slow_frames"]).toBe(2);
        expect(a["frame.frozen_frames"]).toBe(0);
        expect(a["frame.max_total_duration_ms"]).toBe(60);
        expect(a["display.refresh_rate"]).toBe(60);
        expect(a["frame.window_duration_ms"]).toBe(10000);
        expect(a["frame.source"]).toBe("requestAnimationFrame");
        // nearest-rank p95 of 10 samples = ceil(0.95*10)-1 = index 9 (largest) = 60
        expect(a["frame.p95_ms"]).toBe(60);
    });

    it("a frame of 700 ms or more is frozen, and slow too", () => {
        const a = aggregateFrames([16, 16, 700, 900], 2000, "raf");
        expect(a["frame.frozen_frames"]).toBe(2);
        expect(a["frame.slow_frames"]).toBe(2);
    });

    it("reports zero slow frames when every frame is within budget", () => {
        expect(aggregateFrames([10, 12, 14, 16], 500, "raf")["frame.slow_frames"]).toBe(0);
    });

    // §5.1 — the refresh rate is measured from the delta floor, not hardcoded 60.
    it.each([
        ["60 Hz", 1000 / 60, 60],
        ["90 Hz", 1000 / 90, 90],
        ["120 Hz", 1000 / 120, 120],
    ])("measures display.refresh_rate from a %s stream", (_label, interval, expected) => {
        const deltas = Array.from({ length: 40 }, (_, i) => interval * (1 + (i % 3) * 0.05));
        expect(aggregateFrames(deltas, 1000, "raf")["display.refresh_rate"]).toBe(expected);
    });

    it("budgets slow frames against the measured rate, not 60", () => {
        // A 120 Hz stream: budget 8.3ms, threshold 16.6ms. A 20ms frame is slow here and
        // would not have been under the old hardcoded 60 (threshold 33ms).
        const a = aggregateFrames([...Array(20).fill(1000 / 120), 20], 1000, "raf");
        expect(a["display.refresh_rate"]).toBe(120);
        expect(a["frame.slow_frames"]).toBe(1);
    });

    // The floor is p5, not the minimum: one artefact must not snap 60 Hz to 120 and double
    // the slow-frame count — the exact defect the measured key exists to fix.
    it("shrugs off a spurious short delta in a 60 Hz stream", () => {
        const deltas = [...Array(300).fill(1000 / 60), 4, 0.5];
        expect(aggregateFrames(deltas, 5000, "raf")["display.refresh_rate"]).toBe(60);
    });

    it("falls back to 60 when no positive delta was sampled", () => {
        expect(aggregateFrames([0, 0], 100, "raf")["display.refresh_rate"]).toBe(60);
    });

    it("rounds window_duration_ms and never reports a negative window", () => {
        expect(aggregateFrames([16], 33.7, "raf")["frame.window_duration_ms"]).toBe(34);
        expect(aggregateFrames([16], -5, "raf")["frame.window_duration_ms"]).toBe(0);
    });

    it("carries none of the frame_render_time keys the catalogue aliases", () => {
        const a = aggregateFrames([16], 100, "raf");
        for (const old of ["frame.sample_count", "frame.dropped_count", "frame.max_ms", "frame.target_fps", "frame.target_hz"]) {
            expect(a).not.toHaveProperty(old);
        }
    });
});
