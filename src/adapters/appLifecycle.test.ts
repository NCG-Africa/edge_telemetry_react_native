import { describe, it, expect, vi } from "vitest";
import { AppLifecycleEmitter } from "./appLifecycle";

function fakeTelemetry() {
  const calls: Array<{ name: string; data: any }> = [];
  return {
    telemetry: { log: vi.fn((name: string, data?: any) => { calls.push({ name, data }); }) } as any,
    calls,
  };
}

describe("AppLifecycleEmitter (v3 app_lifecycle)", () => {
  it("emits app_lifecycle with the direction on each foreground/background transition", () => {
    const { telemetry, calls } = fakeTelemetry();
    const emitter = new AppLifecycleEmitter(telemetry);

    emitter.onState(true);    // seed (foreground), no event
    emitter.onState(false);   // foreground → background
    emitter.onState(true);    // background → foreground

    expect(calls.map((c) => c.name)).toEqual(["app_lifecycle", "app_lifecycle"]);
    expect(calls[0].data["app_lifecycle.state"]).toBe("background");
    expect(calls[1].data["app_lifecycle.state"]).toBe("foreground");
  });

  it("does not emit on the first sample or when the state is unchanged", () => {
    const { telemetry, calls } = fakeTelemetry();
    const emitter = new AppLifecycleEmitter(telemetry);

    emitter.onState(false);   // seed
    emitter.onState(false);   // unchanged

    expect(calls).toHaveLength(0);
  });
});
