import { describe, it, expect } from "vitest";
import { aggregateFrames } from "./frameAggregate";

describe("aggregateFrames", () => {
    it("computes max, p95 and dropped_count for a 60fps window", () => {
        // 16ms budget → drop threshold 33.3ms. Two frames (40, 60) exceed it.
        const deltas = [16, 16, 16, 16, 16, 16, 16, 16, 40, 60];
        const { value, attributes } = aggregateFrames(deltas, 10000, "requestAnimationFrame");

        expect(attributes["frame.max_ms"]).toBe(60);
        expect(attributes["frame.dropped_count"]).toBe(2);
        expect(attributes["frame.target_fps"]).toBe(60);
        expect(attributes["frame.window_duration_ms"]).toBe(10000);
        expect(attributes["frame.source"]).toBe("requestAnimationFrame");
        // nearest-rank p95 of 10 samples = ceil(0.95*10)-1 = index 9 (largest) = 60
        expect(attributes["frame.p95_ms"]).toBe(60);
        expect(value).toBe(attributes["frame.p95_ms"]);
    });

    it("reports zero drops when every frame is within budget", () => {
        const { attributes } = aggregateFrames([10, 12, 14, 16], 500, "raf");
        expect(attributes["frame.dropped_count"]).toBe(0);
    });

    // §5.1 — the refresh rate is measured from the delta floor, not hardcoded 60.
    it.each([
        ["60 Hz", 1000 / 60, 60],
        ["90 Hz", 1000 / 90, 90],
        ["120 Hz", 1000 / 120, 120],
    ])("measures frame.target_fps from a %s stream", (_label, interval, expected) => {
        const deltas = Array.from({ length: 40 }, (_, i) => interval * (1 + (i % 3) * 0.05));
        expect(aggregateFrames(deltas, 1000, "raf").attributes["frame.target_fps"]).toBe(expected);
    });

    it("budgets dropped frames against the measured rate, not 60", () => {
        // A 120 Hz stream: budget 8.3ms, threshold 16.6ms. A 20ms frame is a drop here and
        // would not have been under the old hardcoded 60 (threshold 33ms).
        const deltas = [...Array(20).fill(1000 / 120), 20];
        const { attributes } = aggregateFrames(deltas, 1000, "raf");
        expect(attributes["frame.target_fps"]).toBe(120);
        expect(attributes["frame.dropped_count"]).toBe(1);
    });

    // The floor is p5, not the minimum: one artefact must not snap 60 Hz to 120 and double
    // the dropped-frame count — the exact defect the measured key exists to fix.
    it("shrugs off a spurious short delta in a 60 Hz stream", () => {
        const deltas = [...Array(300).fill(1000 / 60), 4, 0.5];
        expect(aggregateFrames(deltas, 5000, "raf").attributes["frame.target_fps"]).toBe(60);
    });

    it("falls back to 60 when no positive delta was sampled", () => {
        expect(aggregateFrames([0, 0], 100, "raf").attributes["frame.target_fps"]).toBe(60);
    });

    it("rounds window_duration_ms and never reports a negative window", () => {
        expect(aggregateFrames([16], 33.7, "raf").attributes["frame.window_duration_ms"]).toBe(34);
        expect(aggregateFrames([16], -5, "raf").attributes["frame.window_duration_ms"]).toBe(0);
    });

    it("never carries a frame.target_hz", () => {
        expect(aggregateFrames([16], 100, "raf").attributes).not.toHaveProperty("frame.target_hz");
    });
});
