import { describe, it, expect, vi } from "vitest";
import { AppLifecycleEmitter } from "./appLifecycle";

function fakeTelemetry() {
  const calls: Array<{ name: string; data: any }> = [];
  // `views` is not optional on the real core: background is one of the four view boundaries
  // (§4.5), so a double without it would hide the boundary rather than exercise it.
  const views = { background: vi.fn(async () => {}), foreground: vi.fn(() => {}) };
  return {
    telemetry: {
      log: vi.fn((name: string, data?: any) => { calls.push({ name, data }); }),
      views,
    } as any,
    calls,
    views,
  };
}

/** The emitter chains the view boundary onto the log promise; let the microtasks drain. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("AppLifecycleEmitter (v3 app_lifecycle)", () => {
  it("emits app_lifecycle with the direction on each foreground/background transition", async () => {
    const { telemetry, calls } = fakeTelemetry();
    const emitter = new AppLifecycleEmitter(telemetry);

    emitter.onState(true);    // seed (foreground), no event
    emitter.onState(false);   // foreground → background
    emitter.onState(true);    // background → foreground

    expect(calls.map((c) => c.name)).toEqual(["app_lifecycle", "app_lifecycle"]);
    expect(calls[0].data["app_lifecycle.state"]).toBe("background");
    expect(calls[1].data["app_lifecycle.state"]).toBe("foreground");
    await settle();
  });

  it("ends the view on background and re-arms its clock on foreground (§4.5)", async () => {
    const { telemetry, views } = fakeTelemetry();
    const emitter = new AppLifecycleEmitter(telemetry);

    emitter.onState(true);    // seed — not a transition, so no boundary
    await settle();
    expect(views.background).not.toHaveBeenCalled();

    emitter.onState(false);
    await settle();
    expect(views.background).toHaveBeenCalledTimes(1);

    emitter.onState(true);
    await settle();
    expect(views.foreground).toHaveBeenCalledTimes(1);
  });

  it("does not emit on the first sample or when the state is unchanged", async () => {
    const { telemetry, calls, views } = fakeTelemetry();
    const emitter = new AppLifecycleEmitter(telemetry);

    emitter.onState(false);   // seed
    emitter.onState(false);   // unchanged

    expect(calls).toHaveLength(0);
    await settle();
    expect(views.background).not.toHaveBeenCalled();
  });
});
