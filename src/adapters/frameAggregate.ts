// Aggregate a window of frame deltas (ms) into the iOS-shape frame_render_time metric.
// Shared by the web and native frame trackers so the percentile math lives in one place.
// Additive attributes (frame.*) are tracked in docs/backend-additions-ledger.md.

export interface FrameAggregate {
    value: number;                        // metric value = p95 frame time (representative render time)
    attributes: {
        "frame.max_ms": number;
        "frame.p95_ms": number;
        "frame.dropped_count": number;    // frames slower than 2x budget
        "frame.target_hz": number;
        "frame.source": string;
    };
}

/** deltas must be non-empty. Percentile is nearest-rank on the sorted deltas. */
export function aggregateFrames(deltas: number[], targetFPS: number, source: string): FrameAggregate {
    const budget = 1000 / targetFPS;
    const sorted = [...deltas].sort((a, b) => a - b);
    const max = sorted[sorted.length - 1];
    const p95 = sorted[Math.ceil(0.95 * sorted.length) - 1];
    const dropped = deltas.filter((d) => d > budget * 2).length;

    return {
        value: p95,
        attributes: {
            "frame.max_ms": max,
            "frame.p95_ms": p95,
            "frame.dropped_count": dropped,
            "frame.target_hz": targetFPS,
            "frame.source": source,
        },
    };
}
