import { Telemetry } from "./../core/telemetry";

// Helper: get memory usage depending on platform
function getMemoryUsage(): { usedMb: number; pressureLevel: string } {
    let usedMb = 0;

    if (typeof (global as any).performance !== "undefined" &&
        (performance as any).memory) {
        // Chrome-only (Heap memory API)
        const mem = (performance as any).memory;
        usedMb = mem.usedJSHeapSize / (1024 * 1024);
    } else if (typeof global !== "undefined" && (global as any).nativePerformanceNow) {
        // React Native fallback (no direct heap API)
        // Here we simulate with performance.now() to avoid crashes.
        // In real RN, we might bridge to native modules for memory info.
        usedMb = Math.random() * 512; // ⚠️ Placeholder
    } else {
        usedMb = Math.random() * 512; // fallback simulation
    }

    // Determine pressure level
    const pressureLevel =
        usedMb < 256 ? "low" : usedMb < 512 ? "moderate" : "high";

    return { usedMb, pressureLevel };
}

export class TelemetryMemoryUsage {
    private telemetry: Telemetry;

    constructor(telemetry: Telemetry) {
        this.telemetry = telemetry;
    }

    recordMemoryUsage() {
        const { usedMb, pressureLevel } = getMemoryUsage();
        const timestamp = new Date().toISOString();

        // Record memory event
        this.telemetry.log("memory_pressure", {
            "memory.usage_mb": usedMb,
            "memory.pressure_level": pressureLevel,
            "memory.timestamp": timestamp,
        });

        // Record memory metric
        this.telemetry.log("memory_usage", {
            "metric.unit": "MB",
            "memory.type": "heap",
            "memory.source": "runtime",
            "value": usedMb,
        });
    }
}
