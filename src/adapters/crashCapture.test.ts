import { describe, it, expect, vi } from "vitest";
import { buildCrashAttributes, captureConsole } from "./crashCapture";

function fakeTelemetry() {
  const calls: Array<{ name: string; data: any }> = [];
  return {
    telemetry: { log: vi.fn((name: string, data?: any) => { calls.push({ name, data }); }) } as any,
    calls,
  };
}

describe("buildCrashAttributes — cause discriminator", () => {
  it("namespaces the cause, message and stacktrace under crash.*", () => {
    const a = buildCrashAttributes("Error", { message: "boom", stacktrace: "at x", fatal: true });
    expect(a["crash.cause"]).toBe("Error");
    expect(a["crash.message"]).toBe("boom");
    expect(a["crash.stacktrace"]).toBe("at x");
    expect(a["crash.fatal"]).toBe(true);
  });
});

describe("captureConsole — funnel console.error/warn into app.crash (opt-out)", () => {
  it("emits app.crash with ConsoleError / ConsoleWarn and still calls through", () => {
    const { telemetry, calls } = fakeTelemetry();
    const orig = { error: vi.fn(), warn: vi.fn(), log: vi.fn() };
    const fakeConsole: any = { ...orig };

    const restore = captureConsole(telemetry, fakeConsole);
    fakeConsole.error("oops", 1);
    fakeConsole.warn("careful");

    const causes = calls.filter((c) => c.name === "app.crash").map((c) => c.data["crash.cause"]);
    expect(causes).toEqual(["ConsoleError", "ConsoleWarn"]);
    // original console methods still invoked (capture is non-destructive)
    expect(orig.error).toHaveBeenCalledWith("oops", 1);
    expect(orig.warn).toHaveBeenCalledWith("careful");

    restore();
    fakeConsole.error("after restore");
    expect(calls.filter((c) => c.name === "app.crash")).toHaveLength(2);   // no new crash logged
  });

  it("does not recurse when telemetry.log itself writes to console.error", () => {
    const calls: Array<string> = [];
    const fakeConsole: any = { error: vi.fn(), warn: vi.fn(), log: vi.fn() };
    const telemetry: any = {
      log: vi.fn((name: string) => { calls.push(name); fakeConsole.error("internal noise"); }),
    };

    captureConsole(telemetry, fakeConsole);
    fakeConsole.error("user error");

    // exactly one app.crash — the internal console.error during logging is not re-captured
    expect(calls).toEqual(["app.crash"]);
  });
});
