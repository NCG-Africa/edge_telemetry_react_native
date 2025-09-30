import { Telemetry } from "../../core/telemetry";

// Helper: read memory usage from browser
function getWebMemoryUsage(): number | null {
    const perf: any = performance;
    if (perf && perf.memory) {
        return perf.memory.usedJSHeapSize / (1024 * 1024); // MB
    }
    return null;
}

export class TelemetryMemoryUsageWeb {
    constructor(private telemetry: Telemetry) { }

    recordMemoryUsage() {
        const usedMb = getWebMemoryUsage();
        if (usedMb == null) return; // not supported in this browser

        const pressureLevel =
            usedMb < 256 ? "low" : usedMb < 512 ? "moderate" : "high";

        const timestamp = new Date().toISOString();

        // Log event
        this.telemetry.log("memory_pressure", {
            "memory.usage_mb": usedMb,
            "memory.pressure_level": pressureLevel,
            "memory.timestamp": timestamp,
        });

        // Log metric
        this.telemetry.log("memory_usage", {
            value: usedMb,
            "metric.unit": "MB",
            "memory.type": "heap",
            "memory.source": "performance.memory",
        });
    }

    // auto-interval sampling
    start(intervalMs: number = 30000) {
        this.recordMemoryUsage();
        return setInterval(() => this.recordMemoryUsage(), intervalMs);
    }
}
