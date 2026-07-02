import { describe, it, expect, vi } from "vitest";
import { InteractionEmitter } from "./interaction";
import { Telemetry } from "../core/telemetry";

// Fake telemetry mirrors the AppLifecycleEmitter test seam: capture what the emitter
// hands to telemetry.log — the wire-contract boundary for #33 (user.interaction).
function fakeTelemetry(currentScreen?: string) {
  const calls: Array<{ name: string; data: any }> = [];
  return {
    telemetry: {
      log: vi.fn((name: string, data?: any) => { calls.push({ name, data }); }),
      currentScreen,
    } as any,
    calls,
  };
}

describe("InteractionEmitter (v3 user.interaction)", () => {
  it("record() emits user.interaction with interaction.type", () => {
    const { telemetry, calls } = fakeTelemetry();
    new InteractionEmitter(telemetry).record();

    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("user.interaction");
    expect(calls[0].data["interaction.type"]).toBe("tap");
  });

  it("includes interaction.screen when the current screen is known", () => {
    const { telemetry, calls } = fakeTelemetry("Checkout");
    new InteractionEmitter(telemetry).record();

    expect(calls[0].data["interaction.screen"]).toBe("Checkout");
  });

  it("omits interaction.screen (and any DOM fields) when the screen is unknown", () => {
    const { telemetry, calls } = fakeTelemetry(undefined);
    new InteractionEmitter(telemetry).record();

    const keys = Object.keys(calls[0].data);
    expect(keys).toEqual(["interaction.type"]);   // no interaction.screen, no target_tag/target_class
  });

  it("responderProps() records a tap on capture and never claims the responder", () => {
    const { telemetry, calls } = fakeTelemetry("Home");
    const props = new InteractionEmitter(telemetry).responderProps();

    const claimed = props.onStartShouldSetResponderCapture();

    expect(claimed).toBe(false);   // best-effort: observe the gesture, don't steal it
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("user.interaction");
    expect(calls[0].data["interaction.screen"]).toBe("Home");
  });
});

describe("current screen wiring (real Telemetry core)", () => {
  it("a route change makes the next tap carry that screen", async () => {
    const sender = { send: vi.fn(async (_e: any[]) => {}) };
    const t = new Telemetry({ sender, batchSize: 100, flushIntervalMs: 0 });

    t.recordRouteChange("Home", "Settings");
    await new InteractionEmitter(t).record();

    await t.flush();
    const tap = sender.send.mock.calls[0][0].find((e: any) => e.eventName === "user.interaction");
    expect(tap.attributes["interaction.screen"]).toBe("Settings");
  });

  it("screenStart makes the next tap carry that screen", async () => {
    const sender = { send: vi.fn(async (_e: any[]) => {}) };
    const t = new Telemetry({ sender, batchSize: 100, flushIntervalMs: 0 });

    t.screens.startScreen("Profile");
    await new InteractionEmitter(t).record();

    await t.flush();
    const tap = sender.send.mock.calls[0][0].find((e: any) => e.eventName === "user.interaction");
    expect(tap.attributes["interaction.screen"]).toBe("Profile");
  });
});
