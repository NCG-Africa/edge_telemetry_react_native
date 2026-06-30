import { describe, it, expect, vi } from "vitest";
import { NetworkChangeEmitter } from "./networkChange";

function fakeTelemetry() {
  const calls: Array<{ name: string; data: any }> = [];
  return {
    telemetry: { log: vi.fn((name: string, data?: any) => { calls.push({ name, data }); }) } as any,
    calls,
  };
}

describe("NetworkChangeEmitter (v3 network_change)", () => {
  it("emits one network_change with previous + current type on a transition", () => {
    const { telemetry, calls } = fakeTelemetry();
    const emitter = new NetworkChangeEmitter(telemetry);

    emitter.onSample("wifi");      // baseline — no transition yet
    emitter.onSample("cellular");  // wifi → cellular

    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("network_change");
    expect(calls[0].data["network.previous_type"]).toBe("wifi");
    expect(calls[0].data["network.type"]).toBe("cellular");
    // legacy v2 name never fires
    expect(calls.some((c) => c.name === "network_info_change")).toBe(false);
  });

  it("does not emit on the first sample or when the type is unchanged", () => {
    const { telemetry, calls } = fakeTelemetry();
    const emitter = new NetworkChangeEmitter(telemetry);

    emitter.onSample("wifi");  // first sample: establishes baseline only
    emitter.onSample("wifi");  // no change

    expect(calls).toHaveLength(0);
  });
});
