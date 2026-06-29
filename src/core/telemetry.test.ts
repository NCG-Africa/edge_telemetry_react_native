import { describe, it, expect, vi } from "vitest";
import { Telemetry, type TelemetryEvent } from "./telemetry";

const tick = () => new Promise((r) => setTimeout(r, 0));

function deviceHandler() {
  const info = { app: { name: "app", version: "1.0" }, device: { id: "d1", platform: "web" } };
  return { start: vi.fn(async () => undefined), collect: vi.fn(async () => info) };
}
function networkHandler() {
  const info = { type: "wifi", isConnected: true };
  return { start: vi.fn(async () => info), collect: vi.fn(async () => info) };
}

describe("tracker-registration methods", () => {
  it("assign the handler and fire start() exactly once, synchronously (no Promise wrapper)", () => {
    const t = new Telemetry({ flushIntervalMs: 0 });

    const frame = { start: vi.fn(async () => undefined) };
    const network = { start: vi.fn(async () => undefined) };
    const memory = { recordMemoryUsage: vi.fn(async () => undefined) };
    const crash = { attach: vi.fn(async () => undefined) };

    // return value is void, not a thenable that hangs
    expect(t.trackFrameDrops(frame as any)).toBeUndefined();
    expect(t.trackNetworkRequests(network as any)).toBeUndefined();
    expect(t.trackMemoryUsage(memory as any)).toBeUndefined();
    expect(t.trackErrors(crash as any)).toBeUndefined();

    expect(frame.start).toHaveBeenCalledTimes(1);
    expect(network.start).toHaveBeenCalledTimes(1);
    expect(memory.recordMemoryUsage).toHaveBeenCalledTimes(1);
    expect(crash.attach).toHaveBeenCalledTimes(1);
  });

  it("swallow a rejecting start() instead of throwing", async () => {
    const t = new Telemetry({ flushIntervalMs: 0 });
    const frame = { start: vi.fn().mockRejectedValue(new Error("boom")) };
    expect(() => t.trackFrameDrops(frame as any)).not.toThrow();
    await tick(); // rejection is .catch()-handled, no unhandled rejection
    expect(frame.start).toHaveBeenCalledTimes(1);
  });
});

describe("log()", () => {
  it("completes (no hang) and flushes the event through the sender", async () => {
    const sent: TelemetryEvent[] = [];
    const sender = { send: vi.fn(async (events: TelemetryEvent[]) => { sent.push(...events); }) };

    const t = new Telemetry({
      sender,
      batchSize: 10,
      flushIntervalMs: 0,
      deviceInfoHandler: deviceHandler() as any,
      networkInfoHandler: networkHandler() as any,
    });

    await t.log("checkout_started", { cart_value: 42 });
    await t.flush();

    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].eventName).toBe("checkout_started");
  });

  it("embeds device/network info via collect() (not the registration method) — no recursion", async () => {
    const sent: TelemetryEvent[] = [];
    const sender = { send: vi.fn(async (events: TelemetryEvent[]) => { sent.push(...events); }) };
    const device = deviceHandler();
    const network = networkHandler();

    const t = new Telemetry({
      sender,
      batchSize: 10,
      flushIntervalMs: 0,
      deviceInfoHandler: device as any,
      networkInfoHandler: network as any,
    });

    await t.log("evt", { foo: "bar" });
    await t.flush();

    const attrs = sent[0].attributes!;
    expect(attrs["device.device.platform"]).toBe("web");
    expect(attrs["device.app.name"]).toBe("app");
    expect(attrs["network.type"]).toBe("wifi");
    expect(attrs["foo"]).toBe("bar");

    // collect() is the getter used by log(); start() must NOT be triggered by logging
    expect(device.collect).toHaveBeenCalled();
    expect(network.collect).toHaveBeenCalled();
    expect(device.start).not.toHaveBeenCalled();
    expect(network.start).not.toHaveBeenCalled();
  });
});

describe("flush() retry/persistence", () => {
  it("calls the sender exactly once on success (no core-level retry layer)", async () => {
    const sender = { send: vi.fn(async () => undefined), onFailure: vi.fn(async () => undefined) };
    const t = new Telemetry({ sender, batchSize: 10, flushIntervalMs: 0 });

    await t.log("e");
    await t.flush();

    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(sender.onFailure).not.toHaveBeenCalled();
  });

  it("on failure: sends once (core does not retry) and persists once via onFailure", async () => {
    const sender = {
      send: vi.fn(async () => { throw new Error("net"); }),
      onFailure: vi.fn(async () => undefined),
    };
    const t = new Telemetry({ sender, batchSize: 10, flushIntervalMs: 0 });

    await t.log("e");
    await expect(t.flush()).rejects.toThrow("net");

    expect(sender.send).toHaveBeenCalledTimes(1);     // retry lives in the sender, not here
    expect(sender.onFailure).toHaveBeenCalledTimes(1); // persisted exactly once
  });

  it("requeues the batch if onFailure persistence also fails", async () => {
    const sender = {
      send: vi.fn(async () => { throw new Error("net"); }),
      onFailure: vi.fn(async () => { throw new Error("persist"); }),
    };
    const t = new Telemetry({ sender, batchSize: 10, flushIntervalMs: 0 });

    await t.log("e");
    await expect(t.flush()).rejects.toThrow("net");

    expect(t.getQueue()).toHaveLength(1); // not lost
  });
});
