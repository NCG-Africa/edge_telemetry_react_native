import { describe, it, expect } from "vitest";
import { aggregateFrames } from "./frameAggregate";

describe("aggregateFrames", () => {
    it("computes max, p95 and dropped_count for a 60fps window", () => {
        // 16ms budget → drop threshold 33.3ms. Two frames (40, 60) exceed it.
        const deltas = [16, 16, 16, 16, 16, 16, 16, 16, 40, 60];
        const { value, attributes } = aggregateFrames(deltas, 60, "requestAnimationFrame");

        expect(attributes["frame.max_ms"]).toBe(60);
        expect(attributes["frame.dropped_count"]).toBe(2);
        expect(attributes["frame.target_hz"]).toBe(60);
        expect(attributes["frame.source"]).toBe("requestAnimationFrame");
        // nearest-rank p95 of 10 samples = ceil(0.95*10)-1 = index 9 (largest) = 60
        expect(attributes["frame.p95_ms"]).toBe(60);
        expect(value).toBe(attributes["frame.p95_ms"]);
    });

    it("reports zero drops when every frame is within budget", () => {
        const { attributes } = aggregateFrames([10, 12, 14, 16], 60, "raf");
        expect(attributes["frame.dropped_count"]).toBe(0);
    });
});
