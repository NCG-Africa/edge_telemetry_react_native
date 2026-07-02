// telemetryMemoryUsage.native.ts
import { Telemetry } from "../../core/telemetry";
import { Platform } from "react-native";

/**
 * Attempts to retrieve JavaScript heap memory usage in MB.
 * Note: This is only supported on some JavaScript engines (e.g., Hermes).
 * Returns null if not available.
 */
function getNativeMemoryUsage(): number | null {
    const perf: any = global.performance;
    if (perf && perf.memory && typeof perf.memory.usedJSHeapSize === "number") {
        return perf.memory.usedJSHeapSize / (1024 * 1024); // Convert bytes to MB
    }
    return null;
}

type MemoryPressureLevel = "low" | "moderate" | "high";

/**
 * Logs JavaScript memory usage and pressure level at regular intervals
 * in a React Native environment.
 */
export class TelemetryMemoryUsageNative {
    private intervalId: NodeJS.Timeout | null = null;

    constructor(private telemetry: Telemetry) { }

    /**
     * Records a memory_usage metric (value = used heap MB) per sample, on the v3 metric path.
     */
    recordMemoryUsage(): void {
        const usedMb = getNativeMemoryUsage();
        if (usedMb == null) return; // Skip if unsupported

        // Classify pressure level based on used heap memory (in MB)
        const pressureLevel: MemoryPressureLevel =
            usedMb < 256 ? "low" : usedMb < 512 ? "moderate" : "high";

        this.telemetry.logMetric("memory_usage", usedMb, {
            "memory.usage_mb": usedMb,
            "memory.pressure_level": pressureLevel,
            "memory.unit": "MB",
            "memory.type": "heap",
            "memory.source": Platform.OS,
        });
    }

    /**
     * Starts periodic memory usage logging at the given interval.
     * Returns a resolved Promise for async startup flows.
     * 
     * @param intervalMs Sampling interval in milliseconds (default: 30s)
     */
    start(intervalMs: number = 30000): Promise<void> {
        return new Promise((resolve) => {
            this.recordMemoryUsage();

            this.intervalId = setInterval(() => {
                this.recordMemoryUsage();
            }, intervalMs);

            resolve();
        });
    }

    /**
     * Stops the periodic memory logging if it was started.
     */
    stop(): void {
        if (this.intervalId !== null) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }
}
