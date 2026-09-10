import { Platform } from "react-native";
import DeviceInfoLib from "react-native-device-info";
import { Telemetry } from "../../core/telemetry";
import { debug } from "../../core/debug";

/** §5.2 default sampling interval. */
const SAMPLE_INTERVAL_MS = 30000;

const BYTES_PER_MB = 1024 * 1024;

/**
 * §5.2 / #105 — `memory_usage`: RSS, **native only**, sampled every 30 s. The rationale for
 * every part of that sentence lives in CLAUDE.md's `memory_usage` section; this file is the
 * mechanism.
 */
export class TelemetryMemoryUsageNative {
    private intervalId: ReturnType<typeof setInterval> | null = null;

    constructor(private telemetry: Telemetry) { }

    /**
     * One sample: `value` = resident MB, with the device total alongside so headroom is
     * readable without a second join. An unusable read emits nothing — a fabricated 0 would
     * drag every percentile down and read as a memory *win*.
     *
     * The two reads are guarded separately on purpose: `value` is what §5.2 makes primary,
     * so a device-info build whose `getTotalMemory()` throws must still ship the resident
     * figure with `memory.total_mb` simply absent.
     */
    async recordMemoryUsage(): Promise<void> {
        const usedBytes = await readBytes(() => DeviceInfoLib.getUsedMemory());
        if (usedBytes === undefined) return;

        const attrs: Record<string, string | number> = {
            "memory.type": "rss",
            "memory.source": Platform.OS,
        };
        const totalBytes = await readBytes(() => DeviceInfoLib.getTotalMemory());
        if (totalBytes !== undefined && totalBytes > 0) {
            attrs["memory.total_mb"] = totalBytes / BYTES_PER_MB;
        }

        await this.telemetry.logMetric("memory_usage", usedBytes / BYTES_PER_MB, attrs);
    }

    /**
     * Starts the periodic sampler. v3 never called this — `trackMemoryUsage()` fired the
     * one-shot read and applied `.catch` to its `void` return — so the metric was
     * single-shot at best.
     */
    async start(): Promise<void> {
        if (this.intervalId !== null) return;   // idempotent: one loop per instance
        this.intervalId = setInterval(() => {
            void this.recordMemoryUsage();
        }, SAMPLE_INTERVAL_MS);
        await this.recordMemoryUsage();
    }

    /** Stops the periodic sampler. Called by `Telemetry.shutdown()`. */
    stop(): void {
        if (this.intervalId !== null) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }
}

/**
 * One device-info read, reduced to `number | undefined`. Both a throw (the package is a
 * peer dep — a consumer can be on a build without the native module) and a non-finite or
 * negative reading mean "nothing to report", and the caller treats them the same.
 */
async function readBytes(read: () => Promise<number>): Promise<number | undefined> {
    try {
        const bytes = await read();
        return Number.isFinite(bytes) && bytes >= 0 ? bytes : undefined;
    } catch (err) {
        debug.warn("memory_usage read failed:", err);
        return undefined;
    }
}
