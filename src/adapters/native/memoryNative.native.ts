import { Telemetry } from "../../core/telemetry";
import { Platform } from "react-native";

// Helper: try to read RN runtime memory usage
function getNativeMemoryUsage(): number | null {
    const perf: any = global.performance;
    if (perf && perf.memory) {
        return perf.memory.usedJSHeapSize / (1024 * 1024); // MB
    }
    return null; // not supported by all engines
}

export class TelemetryMemoryUsageNative {
    constructor(private telemetry: Telemetry) { }

    recordMemoryUsage() {
        const usedMb = getNativeMemoryUsage();
        if (usedMb == null) return; // skip if unsupported

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
            "memory.source": Platform.OS,
        });
    }

    // auto-interval sampling
    start(intervalMs: number = 30000) {
        this.recordMemoryUsage();
        return setInterval(() => this.recordMemoryUsage(), intervalMs);
    }
}
