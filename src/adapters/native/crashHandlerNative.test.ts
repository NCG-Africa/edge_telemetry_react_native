import { describe, it, expect, vi, afterEach } from "vitest";
import { CrashHandlerNative } from "./crashHandlerNative.native";

function fakeTelemetry() {
  const calls: Array<{ name: string; data: any }> = [];
  return {
    telemetry: { log: vi.fn((name: string, data?: any) => { calls.push({ name, data }); }) } as any,
    calls,
  };
}

const g = global as any;
afterEach(() => { delete g.ErrorUtils; delete g.__rejectionHandler; });

describe("CrashHandlerNative — unified app.crash with cause (#28)", () => {
  it("funnels a thrown error into app.crash with cause=Error", async () => {
    let handler: ((e: any, fatal?: boolean) => void) | undefined;
    g.ErrorUtils = { setGlobalHandler: (h: any) => { handler = h; }, getGlobalHandler: () => undefined };

    const { telemetry, calls } = fakeTelemetry();
    await new CrashHandlerNative(telemetry).attach({ captureConsole: false });

    handler!(new Error("boom"), true);

    const crash = calls.find((c) => c.name === "app.crash")!;
    expect(crash.data["crash.cause"]).toBe("Error");
    expect(crash.data["crash.message"]).toBe("boom");
    expect(crash.data["crash.fatal"]).toBe(true);
  });

  it("funnels an unhandled rejection into app.crash with cause=UnhandledRejection", async () => {
    let rejHandler: ((e: any) => void) | undefined;
    g.addEventListener = (type: string, cb: any) => { if (type === "unhandledrejection") rejHandler = cb; };
    g.ErrorUtils = { setGlobalHandler: () => {}, getGlobalHandler: () => undefined };

    const { telemetry, calls } = fakeTelemetry();
    await new CrashHandlerNative(telemetry).attach({ captureConsole: false });

    rejHandler!({ reason: new Error("rej") });

    const crash = calls.find((c) => c.name === "app.crash")!;
    expect(crash.data["crash.cause"]).toBe("UnhandledRejection");
    expect(crash.data["crash.message"]).toBe("rej");
    expect(calls.some((c) => c.name === "app.error")).toBe(false);   // legacy name gone
  });
});
