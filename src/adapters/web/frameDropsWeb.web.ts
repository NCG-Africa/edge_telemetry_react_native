import { Telemetry } from "../../core/telemetry";
import { aggregateFrames } from "../frameAggregate";

/**
 * Samples frame deltas via requestAnimationFrame and emits an aggregated
 * `frame_render_time` metric (max/p95/dropped_count) once per window — instead of one event
 * per dropped frame. The metric shape matches the iOS contract (docs/edgerum-contract.md).
 */
export class FrameDropTrackerWeb {
    private lastFrameTime = performance.now();
    private windowStart = performance.now();
    private deltas: number[] = [];

    constructor(
        private telemetry: Telemetry,
        private targetFPS = 60,
        private windowMs = 10000,
    ) { }

    start(): Promise<void> {
        return new Promise((resolve) => {
            const loop = (currentTime: number) => {
                this.deltas.push(currentTime - this.lastFrameTime);
                this.lastFrameTime = currentTime;

                if (currentTime - this.windowStart >= this.windowMs && this.deltas.length > 0) {
                    // ponytail: first window includes the startup delta; acceptable noise, not worth gating.
                    const { value, attributes } = aggregateFrames(this.deltas, this.targetFPS, "requestAnimationFrame");
                    this.telemetry.logMetric("frame_render_time", value, attributes);
                    this.deltas = [];
                    this.windowStart = currentTime;
                }

                requestAnimationFrame(loop);
            };

            requestAnimationFrame(loop);
            resolve();
        });
    }
}
