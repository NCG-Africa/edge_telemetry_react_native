import { describe, it, expect, vi } from "vitest";
import { Telemetry } from "../core/telemetry";
import { TelemetryMemoryUsage } from "./telemetryMemoryUsage";

describe("memory sampling", () => {
  it("emits exactly one memory_usage event per sample (not two overlapping ones)", () => {
    const t = new Telemetry({ flushIntervalMs: 0 });
    const logSpy = vi.spyOn(t, "log").mockResolvedValue(undefined);

    new TelemetryMemoryUsage(t).recordMemoryUsage();

    expect(logSpy).toHaveBeenCalledTimes(1);
    const [name, attrs] = logSpy.mock.calls[0];
    expect(name).toBe("memory_usage");
    // single event carries both the usage value and the pressure level
    expect(attrs).toHaveProperty("value");
    expect(attrs).toHaveProperty("memory.pressure_level");
    expect((attrs as any)["metric.unit"]).toBe("MB");
  });
});
