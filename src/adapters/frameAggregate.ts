// Aggregate a window of frame deltas (ms) into one `frame.summary` window (§5.1, #179 — catalogue
// frames_memory.yaml). Shared by both builds so the percentile math and the refresh-rate
// measurement live once. The SDK classifies; analytics only sums.

/** A frame at or over this is frozen (catalogue #33), whatever the refresh rate. */
const FROZEN_MS = 700;

export type FrameWindow = {
    "frame.total_frames": number;
    "frame.slow_frames": number;           // frames slower than 2x the measured budget
    "frame.frozen_frames": number;         // >= 700 ms
    "frame.max_total_duration_ms": number;
    "frame.p95_ms": number;                // bag only
    "display.refresh_rate": number;
    "frame.window_duration_ms": number;
    "frame.source": string;
};

/**
 * §5.1 fixes the domain at three values. A 144 Hz panel therefore snaps to 120 — the
 * point of the key is the dropped-frame budget, not a display census.
 */
const REFRESH_RATES = [60, 90, 120];

/**
 * The refresh rate, **measured** rather than assumed (§5.1). rAF cannot fire faster than the
 * display, so the floor of the window's deltas *is* the refresh interval — no new platform
 * API is involved.
 *
 * ⚠ The floor is the **5th percentile, not the minimum**. A single spurious short delta — a
 * double-dispatched callback, a clock adjustment — would snap a 60 Hz device to 120 and double
 * its `frame.dropped_count`, reintroducing the wrong-budget defect this key exists to fix. A
 * real 120 Hz display produces short deltas by the hundred, so p5 finds them and one artefact
 * cannot. Snapping to the three-value domain absorbs whatever jitter is left.
 *
 * ponytail: a window with no positive delta falls back to 60, which is also v3's constant.
 */
function measureTargetFps(sorted: number[]): number {
    const positive = sorted.filter((d) => d > 0);
    if (positive.length === 0) return 60;
    const floor = positive[Math.ceil(0.05 * positive.length) - 1] ?? positive[0];
    const fps = 1000 / floor;
    return REFRESH_RATES.reduce((a, b) => (Math.abs(b - fps) < Math.abs(a - fps) ? b : a));
}

/**
 * `deltas` must be non-empty. Percentile is nearest-rank on the sorted deltas.
 * `windowMs` is the *actual* elapsed window — variable-length since §5.1's view-boundary
 * reset, which is exactly why `frame.window_duration_ms` rides every window.
 *
 * A rAF delta is a vsync interval, quantized to the budget: "slow" is a missed vsync, read as
 * over twice the budget so jitter around one interval never counts.
 */
export function aggregateFrames(deltas: number[], windowMs: number, source: string): FrameWindow {
    const sorted = [...deltas].sort((a, b) => a - b);
    const targetFps = measureTargetFps(sorted);
    const budget = 1000 / targetFps;
    return {
        "frame.total_frames": deltas.length,
        "frame.slow_frames": deltas.filter((d) => d > budget * 2).length,
        "frame.frozen_frames": deltas.filter((d) => d >= FROZEN_MS).length,
        "frame.max_total_duration_ms": sorted[sorted.length - 1],
        "frame.p95_ms": sorted[Math.ceil(0.95 * sorted.length) - 1],
        "display.refresh_rate": targetFps,
        "frame.window_duration_ms": Math.round(Math.max(0, windowMs)),
        "frame.source": source,
    };
}
