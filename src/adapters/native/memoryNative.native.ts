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

interface MemoryPressureEvent {
    "memory.usage_mb": number;
    "memory.pressure_level": MemoryPressureLevel;
    "memory.timestamp": string;
}

interface MemoryUsageMetric {
    value: number;
    "metric.unit": string;
    "memory.type": string;
    "memory.source": string;
}

/**
 * Logs JavaScript memory usage and pressure level at regular intervals
 * in a React Native environment.
 */
export class TelemetryMemoryUsageNative {
    private intervalId: NodeJS.Timeout | null = null;

    constructor(private telemetry: Telemetry) { }

    /**
     * Records current memory usage and logs:
     * - A memory pressure event
     * - A memory usage metric
     */
    recordMemoryUsage(): void {
        const usedMb = getNativeMemoryUsage();
        if (usedMb == null) return; // Skip if unsupported

        // Classify pressure level based on used heap memory (in MB)
        const pressureLevel: MemoryPressureLevel =
            usedMb < 256 ? "low" : usedMb < 512 ? "moderate" : "high";

        const timestamp = new Date().toISOString();

        const event: MemoryPressureEvent = {
            "memory.usage_mb": usedMb,
            "memory.pressure_level": pressureLevel,
            "memory.timestamp": timestamp,
        };

        const metric: MemoryUsageMetric = {
            value: usedMb,
            "metric.unit": "MB",
            "memory.type": "heap",
            "memory.source": Platform.OS,
        };

        this.telemetry.log("memory_pressure", event);
        this.telemetry.log("memory_usage", metric);
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
