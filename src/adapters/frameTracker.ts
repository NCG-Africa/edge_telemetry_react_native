// The rAF sampling loop behind `frame_render_time` (§5.1), shared by both builds: rAF and
// `performance.now()` are globals RN polyfills and the browser ships, so there is nothing
// platform-specific left to split. Web and native therefore cannot drift on window length,
// on the refresh-rate measurement or on the boundary reset.

import { aggregateFrames } from "./frameAggregate";

/**
 * All this tracker needs of core. Structural, so it is testable without a `Telemetry`.
 */
type Emitter = {
    logMetric(name: string, value: number, data?: Record<string, any>): unknown;
    views: { onBoundary(fn: () => unknown): () => void };
};

export class FrameDropTracker {
    private lastFrameTime = performance.now();
    private windowStart = this.lastFrameTime;
    private deltas: number[] = [];
    private unsubscribe?: () => void;

    constructor(private telemetry: Emitter, private windowMs = 10000) { }

    start(): Promise<void> {
        // Idempotent: one subscription per instance however often start() is called.
        this.unsubscribe ??= this.telemetry.views.onBoundary(() => this.emitWindow(performance.now()));

        const loop = () => {
            const now = performance.now();
            this.deltas.push(now - this.lastFrameTime);
            this.lastFrameTime = now;
            // ponytail: first window includes the startup delta; acceptable noise, not worth gating.
            if (now - this.windowStart >= this.windowMs) void this.emitWindow(now);
            requestAnimationFrame(loop);
        };

        requestAnimationFrame(loop);
        return Promise.resolve();
    }

    /** Stop feeding the boundary hook — a torn-down tracker must not keep the manager alive. */
    stop(): void {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
    }

    /**
     * Close the open window and ship it. `ViewManager` **awaits** this at a boundary and
     * before the successor mints, which is what lands a route change's dropped frames on the
     * departing `view.id` rather than the arriving one (§5.1).
     *
     * An empty window emits nothing — a p95 over no samples is not a number — but it still
     * resets the clock, so `frame.window_duration_ms` always describes the samples it carries.
     */
    private async emitWindow(now: number): Promise<void> {
        const elapsed = now - this.windowStart;
        this.windowStart = now;
        if (this.deltas.length === 0) return;

        const { value, attributes } = aggregateFrames(this.deltas, elapsed, "requestAnimationFrame");
        this.deltas = [];
        await this.telemetry.logMetric("frame_render_time", value, attributes);
    }
}
