import { Platform } from "react-native";
import DeviceInfoLib from "react-native-device-info";
import { Telemetry } from "../../core/telemetry";
import { debug } from "../../core/debug";

/** §5.2 default sampling interval. */
const SAMPLE_INTERVAL_MS = 30000;

const BYTES_PER_MB = 1024 * 1024;

/**
 * §5.2 / #105 — `memory_usage`, **native only**, sourced from the device-info package's
 * used-memory call.
 *
 * RSS, not heap: `performance.memory` sees the JS heap alone, while RN's memory lives
 * largely in native allocations (images, native views) — which are what actually get the
 * process OOM-killed. RSS is also engine- and architecture-independent, so a Hermes and a
 * JSC build report the same quantity.
 *
 * The metric is Tier 3 (trace-free) — a windowed sample belongs to no single action.
 */
export class TelemetryMemoryUsageNative {
    private intervalId: ReturnType<typeof setInterval> | null = null;

    constructor(private telemetry: Telemetry) { }

    /**
     * One sample: `value` = resident MB, with the device total alongside so headroom is
     * readable without a second join. A device-info call that throws or reports a
     * non-finite number emits nothing — a fabricated 0 would drag every percentile down.
     */
    async recordMemoryUsage(): Promise<void> {
        let usedBytes: number;
        let totalBytes: number;
        try {
            usedBytes = await DeviceInfoLib.getUsedMemory();
            totalBytes = await DeviceInfoLib.getTotalMemory();
        } catch (err) {
            debug.warn("memory_usage sample failed:", err);
            return;
        }
        if (!Number.isFinite(usedBytes) || usedBytes < 0) return;

        const usedMb = usedBytes / BYTES_PER_MB;
        const attrs: Record<string, any> = {
            "memory.type": "rss",
            "memory.source": Platform.OS,
        };
        if (Number.isFinite(totalBytes) && totalBytes > 0) {
            attrs["memory.total_mb"] = totalBytes / BYTES_PER_MB;
        }

        await this.telemetry.logMetric("memory_usage", usedMb, attrs);
    }

    /**
     * Starts the periodic sampler. v3 never called this — `trackMemoryUsage()` fired the
     * one-shot read and applied `.catch` to its `void` return — so the metric was
     * single-shot at best.
     */
    async start(intervalMs: number = SAMPLE_INTERVAL_MS): Promise<void> {
        if (this.intervalId !== null) return;   // idempotent: one loop per instance
        this.intervalId = setInterval(() => {
            void this.recordMemoryUsage();
        }, intervalMs);
        await this.recordMemoryUsage();
    }

    /** Stops the periodic sampler if it was started. */
    stop(): void {
        if (this.intervalId !== null) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }
}
