import { Telemetry } from "../../core/telemetry";

/**
 * Attempts to retrieve JavaScript heap memory usage in MB from the browser's
 * performance API. Returns null if unsupported.
 */
function getWebMemoryUsage(): number | null {
    const perf: any = performance;
    if (perf && perf.memory && typeof perf.memory.usedJSHeapSize === "number") {
        return perf.memory.usedJSHeapSize / (1024 * 1024); // bytes to MB
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
 * Logs JavaScript heap memory usage and pressure level at regular intervals
 * in browser environments using the Performance API.
 */
export class TelemetryMemoryUsageWeb {
    private intervalId: number | null = null;

    constructor(private telemetry: Telemetry) { }

    /**
     * Records current memory usage and logs:
     * - A memory pressure event
     * - A memory usage metric
     */
    recordMemoryUsage(): void {
        const usedMb = getWebMemoryUsage();
        if (usedMb == null) return; // Unsupported in this browser

        // Define pressure levels based on used heap size (MB)
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
            "memory.source": "performance.memory",
        };

        this.telemetry.log("memory_pressure", event);
        this.telemetry.log("memory_usage", metric);
    }

    /**
     * Starts periodic memory usage logging at the specified interval.
     * Returns a Promise that resolves immediately for async compatibility.
     *
     * @param intervalMs Interval in milliseconds between samples (default 30s)
     * @returns Promise<void>
     */
    start(intervalMs: number = 30000): Promise<void> {
        return new Promise((resolve) => {
            this.recordMemoryUsage();

            this.intervalId = window.setInterval(() => {
                this.recordMemoryUsage();
            }, intervalMs);

            resolve();
        });
    }

    /**
     * Stops the periodic memory logging if running.
     */
    stop(): void {
        if (this.intervalId !== null) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }
}
