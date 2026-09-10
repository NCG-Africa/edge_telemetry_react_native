import { describe, it, expect, vi, afterEach } from "vitest";
import { CrashHandlerNative } from "./crashHandlerNative.native";

function fakeTelemetry() {
  const calls: Array<{ name: string; data: any }> = [];
  return {
    telemetry: {
      log: vi.fn((name: string, data?: any) => { calls.push({ name, data }); }),
      addBreadcrumb: vi.fn(),
    } as any,
    calls,
  };
}

const g = global as any;
afterEach(() => { delete g.ErrorUtils; delete g.__rejectionHandler; });

describe("CrashHandlerNative — app.crash with dotted error.* (§4.7, #100)", () => {
  it("funnels a thrown error into app.crash with source=global_handler and a native error.fatal", async () => {
    let handler: ((e: any, fatal?: boolean) => void) | undefined;
    g.ErrorUtils = { setGlobalHandler: (h: any) => { handler = h; }, getGlobalHandler: () => undefined };

    const { telemetry, calls } = fakeTelemetry();
    await new CrashHandlerNative(telemetry).attach();

    handler!(new Error("boom"), true);

    const crash = calls.find((c) => c.name === "app.crash")!;
    expect(crash.data["error.source"]).toBe("global_handler");
    expect(crash.data["error.type"]).toBe("Error");
    expect(crash.data["error.message"]).toBe("boom");
    expect(crash.data["error.fatal"]).toBe(true);
    expect(Object.keys(crash.data).some((k) => k.startsWith("crash."))).toBe(false);
  });

  it("funnels an unhandled rejection into app.crash with source=unhandled_rejection", async () => {
    let rejHandler: ((e: any) => void) | undefined;
    g.addEventListener = (type: string, cb: any) => { if (type === "unhandledrejection") rejHandler = cb; };
    g.ErrorUtils = { setGlobalHandler: () => {}, getGlobalHandler: () => undefined };

    const { telemetry, calls } = fakeTelemetry();
    await new CrashHandlerNative(telemetry).attach();

    rejHandler!({ reason: new Error("rej") });

    const crash = calls.find((c) => c.name === "app.crash")!;
    expect(crash.data["error.source"]).toBe("unhandled_rejection");
    expect(crash.data["error.message"]).toBe("rej");
    expect(crash.data["error.fatal"]).toBe(false);
  });

  it("captures no console by default — a console.error under the default emits nothing (§4.7)", async () => {
    g.ErrorUtils = { setGlobalHandler: () => {}, getGlobalHandler: () => undefined };
    const { telemetry, calls } = fakeTelemetry();

    const before = console.error;
    await new CrashHandlerNative(telemetry).attach();
    expect(console.error).toBe(before);   // unpatched
    expect(calls).toHaveLength(0);
  });
});
