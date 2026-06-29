import { describe, it, expect, vi } from "vitest";
import { Telemetry, type TelemetryEvent } from "./telemetry";
import { ScreenTimingTracker } from "../adapters/screenTiming";

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

    await t.log("navigation", { "navigation.to_screen": "Home" });
    await t.flush();

    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].eventName).toBe("navigation");
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
    // Context block uses flat contract keys, not the v2 double-nested device.device.*
    expect(attrs["device.platform"]).toBe("web");
    expect(attrs["app.name"]).toBe("app");
    expect(attrs["device.device.platform"]).toBeUndefined();
    expect(attrs["device.app.name"]).toBeUndefined();
    expect(attrs["network.type"]).toBe("wifi");
    expect(attrs["foo"]).toBe("bar");

    // collect() is the getter used by log(); start() must NOT be triggered by logging
    expect(device.collect).toHaveBeenCalled();
    expect(network.collect).toHaveBeenCalled();
    expect(device.start).not.toHaveBeenCalled();
    expect(network.start).not.toHaveBeenCalled();
  });
});

describe("v3 wire contract — event shape", () => {
  it("emits {type:'event', eventName, ISO-string timestamp} with no top-level userId/sessionId", async () => {
    const sent: TelemetryEvent[] = [];
    const sender = { send: vi.fn(async (e: TelemetryEvent[]) => { sent.push(...e); }) };

    const t = new Telemetry({
      sender,
      batchSize: 10,
      flushIntervalMs: 0,
      deviceInfoHandler: deviceHandler() as any,
      networkInfoHandler: networkHandler() as any,
    });

    await t.log("custom_event", { a: 1 });
    await t.flush();

    const e = sent[0];
    expect(e.type).toBe("event");
    expect(e.eventName).toBe("custom_event");
    // ISO 8601 string, not a ms-epoch number
    expect(typeof e.timestamp).toBe("string");
    expect(new Date(e.timestamp as unknown as string).toISOString()).toBe(e.timestamp);
    // identity lives in attributes, never on the event object
    expect("userId" in e).toBe(false);
    expect("sessionId" in e).toBe(false);
  });
});

describe("v3 wire contract — Context block identity", () => {
  it("attaches sdk.platform, sdk.version, session.id, session.start_time (ISO) and user.id to every event", async () => {
    const sent: TelemetryEvent[] = [];
    const sender = { send: vi.fn(async (e: TelemetryEvent[]) => { sent.push(...e); }) };

    const t = new Telemetry({
      sender,
      batchSize: 10,
      flushIntervalMs: 0,
      deviceInfoHandler: deviceHandler() as any,
      networkInfoHandler: networkHandler() as any,
    });

    await t.log("custom_event");
    await t.flush();

    const a = sent[0].attributes!;
    expect(a["sdk.platform"]).toBe("react-native");
    expect(typeof a["sdk.version"]).toBe("string");
    expect(a["sdk.version"]!.length).toBeGreaterThan(0);
    expect(typeof a["session.id"]).toBe("string");
    expect(typeof a["user.id"]).toBe("string");
    // session.start_time is an ISO string, not a ms number
    expect(a["session.start_time"]).toBe(new Date(a["session.start_time"]).toISOString());
  });

  it("does not emit the dropped Angular-only fields", async () => {
    const sent: TelemetryEvent[] = [];
    const sender = { send: vi.fn(async (e: TelemetryEvent[]) => { sent.push(...e); }) };
    const t = new Telemetry({
      sender, batchSize: 10, flushIntervalMs: 0,
      deviceInfoHandler: deviceHandler() as any,
      networkInfoHandler: networkHandler() as any,
    });

    await t.log("custom_event");
    await t.flush();

    const a = sent[0].attributes!;
    for (const dropped of [
      "sdk.contract_version",
      "session.is_first_session",
      "session.total_sessions",
      "network.connected",
      "network.downlinkMbps",
    ]) {
      expect(a[dropped]).toBeUndefined();
    }
  });

  it("does not emit non-contract extras (session.event_count, attributes-level timestamp)", async () => {
    const sent: TelemetryEvent[] = [];
    const sender = { send: vi.fn(async (e: TelemetryEvent[]) => { sent.push(...e); }) };
    const t = new Telemetry({
      sender, batchSize: 10, flushIntervalMs: 0,
      deviceInfoHandler: deviceHandler() as any,
      networkInfoHandler: networkHandler() as any,
    });

    await t.log("custom_event");
    await t.flush();

    const a = sent[0].attributes!;
    expect(a["session.event_count"]).toBeUndefined();
    expect(a["timestamp"]).toBeUndefined();   // event timestamp lives at the top level, not in attributes
  });
});

describe("v3 wire contract — sdk.version", () => {
  it("reports the package version, not a hardcoded string", async () => {
    const pkg = (await import("../../package.json")).default as { version: string };
    const sent: TelemetryEvent[] = [];
    const sender = { send: vi.fn(async (e: TelemetryEvent[]) => { sent.push(...e); }) };
    const t = new Telemetry({
      sender, batchSize: 10, flushIntervalMs: 0,
      deviceInfoHandler: deviceHandler() as any,
      networkInfoHandler: networkHandler() as any,
    });

    await t.log("custom_event");
    await t.flush();

    expect(sent[0].attributes!["sdk.version"]).toBe(pkg.version);
  });
});

describe("v3 wire contract — event-name allowlist", () => {
  function captureSender(sent: TelemetryEvent[]) {
    return { send: vi.fn(async (e: TelemetryEvent[]) => { sent.push(...e); }) };
  }

  it("passes an allowlisted name through unchanged", async () => {
    const sent: TelemetryEvent[] = [];
    const t = new Telemetry({
      sender: captureSender(sent), batchSize: 10, flushIntervalMs: 0,
      deviceInfoHandler: deviceHandler() as any, networkInfoHandler: networkHandler() as any,
    });

    await t.log("navigation", { "navigation.to_screen": "Home" });
    await t.flush();

    expect(sent[0].eventName).toBe("navigation");
    expect(sent[0].attributes!["event.name"]).toBeUndefined();
  });

  it("remaps a non-allowlisted name to custom_event and preserves it as event.name", async () => {
    const sent: TelemetryEvent[] = [];
    const t = new Telemetry({
      sender: captureSender(sent), batchSize: 10, flushIntervalMs: 0,
      deviceInfoHandler: deviceHandler() as any, networkInfoHandler: networkHandler() as any,
    });

    await t.log("checkout_started", { cart_value: 42 });
    await t.flush();

    expect(sent[0].eventName).toBe("custom_event");
    expect(sent[0].attributes!["event.name"]).toBe("checkout_started");
    // original payload still rides along
    expect(sent[0].attributes!["cart_value"]).toBe(42);
  });
});

describe("v3 wire contract — id formats", () => {
  it("session.id is session_{ms}_{16hex}_{os}; user.id is user_{ms}_{16hex} with no suffix", () => {
    const t = new Telemetry({ flushIntervalMs: 0, platform: "ios" } as any);

    expect(t.getSessionId()).toMatch(/^session_\d+_[0-9a-f]{16}_ios$/);
    expect(t.generateUserId()).toMatch(/^user_\d+_[0-9a-f]{16}$/);

    // distinct user ids across calls
    expect(t.generateUserId()).not.toBe(t.generateUserId());
  });

  it("omits the OS suffix when the device platform is unknown (still contract-valid)", () => {
    const t = new Telemetry({ flushIntervalMs: 0 });
    expect(t.getSessionId()).toMatch(/^session_\d+_[0-9a-f]{16}$/);
  });
});

describe("screen tracking", () => {
  it("exposes a single timed ScreenTimingTracker as `screens`; core has no untimed methods", () => {
    const t = new Telemetry({ flushIntervalMs: 0 });
    expect(t.screens).toBeInstanceOf(ScreenTimingTracker);
    expect((t as any).startScreen).toBeUndefined();
    expect((t as any).endScreen).toBeUndefined();
  });

  it("emits one screen_view + one performance.screen_duration per screen, no screen_end", () => {
    const t = new Telemetry({ flushIntervalMs: 0 });
    const logSpy = vi.spyOn(t, "log").mockResolvedValue(undefined);

    t.screens.startScreen("Home");
    t.screens.endScreen("Home");

    const calls = logSpy.mock.calls.map((c) => c[0]);
    expect(calls).toEqual(["screen_view", "performance.screen_duration"]);
    expect(calls).not.toContain("screen_end");

    expect(logSpy).toHaveBeenCalledWith("screen_view", { "screen.name": "Home" });
    const durationCall = logSpy.mock.calls.find((c) => c[0] === "performance.screen_duration")!;
    expect(durationCall[1]).toMatchObject({ "screen.name": "Home" });
    expect(typeof (durationCall[1] as any)["duration_ms"]).toBe("number");
  });
});

describe("recordMetric", () => {
  it("still emits via log, with the dead metric counter/accessor removed", () => {
    const t = new Telemetry({ flushIntervalMs: 0 });
    const logSpy = vi.spyOn(t, "log").mockResolvedValue(undefined);

    t.recordMetric("load_time", 123, { page: "home" });

    expect(logSpy).toHaveBeenCalledWith(
      "load_time",
      expect.objectContaining({ value: 123, metric: true, page: "home" }),
    );
    expect((t as any).getMetricCount).toBeUndefined();
  });
});

describe("navigation route changes", () => {
  it("emits exactly one event (navigation.route_change) per route change", () => {
    const t = new Telemetry({ flushIntervalMs: 0 });
    const logSpy = vi.spyOn(t, "log").mockResolvedValue(undefined);

    t.recordRouteChange("Home", "Profile");

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      "navigation.route_change",
      expect.objectContaining({ "navigation.from": "Home", "navigation.to": "Profile" }),
    );
  });

  it("no longer exposes the double-emitting recordNavigation", () => {
    const t = new Telemetry({ flushIntervalMs: 0 });
    expect((t as any).recordNavigation).toBeUndefined();
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
