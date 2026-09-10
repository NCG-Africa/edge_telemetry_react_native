import { describe, it, expect, vi } from "vitest";
import { TelemetryBase } from "./index.base";
import { TelemetryWeb } from "./index.web";
import { TelemetryNative } from "./index.native";

// A fake core that records every call, so we can assert the base forwards verbatim.
function fakeCore() {
  return {
    log: vi.fn(),
    flush: vi.fn(),
    shutdown: vi.fn(),
    trackErrors: vi.fn(),
    setUserId: vi.fn(),
    setUserProfile: vi.fn(),
    setUserDetails: vi.fn(),
    updateUserProfile: vi.fn(),
    getUserProfile: vi.fn(() => ({ fullName: "Ada" })),
    clearUserProfile: vi.fn(),
    setUserName: vi.fn(),
    setUserContact: vi.fn(),
    identify: vi.fn(),
  };
}

// Minimal concrete subclass that injects the fake core instead of building a platform one.
class TestTelemetry extends TelemetryBase {
  constructor(core: any) {
    super();
    this.instancePromise = Promise.resolve(core);
  }
}

describe("TelemetryBase delegation", () => {
  it("forwards each method to the core instance with the same arguments", async () => {
    const core = fakeCore();
    const t = new TestTelemetry(core);

    await t.log("checkout", { v: 1 });
    expect(core.log).toHaveBeenCalledWith("checkout", { v: 1 });

    await t.flush();
    expect(core.flush).toHaveBeenCalledOnce();

    await t.shutdown();
    expect(core.shutdown).toHaveBeenCalledOnce();

    await t.setUserId("abc");
    expect(core.setUserId).toHaveBeenCalledWith("abc");

    await t.setUserProfile({ fullName: "Ada", email: "a@x.io" });
    expect(core.setUserProfile).toHaveBeenCalledWith({ fullName: "Ada", email: "a@x.io" });

    await t.setUserDetails({ firstName: "Ada" });
    expect(core.setUserDetails).toHaveBeenCalledWith({ firstName: "Ada" });

    await t.updateUserProfile({ phone: "123" });
    expect(core.updateUserProfile).toHaveBeenCalledWith({ phone: "123" });

    await t.clearUserProfile();
    expect(core.clearUserProfile).toHaveBeenCalledOnce();

    await t.setUserName("Ada Lovelace", "Ada", "Lovelace");
    expect(core.setUserName).toHaveBeenCalledWith("Ada Lovelace", "Ada", "Lovelace");

    await t.setUserContact("a@x.io", "123");
    expect(core.setUserContact).toHaveBeenCalledWith("a@x.io", "123");

    await t.identify({ name: "Ada", email: "a@x.io" });
    expect(core.identify).toHaveBeenCalledWith({ name: "Ada", email: "a@x.io" });
  });

  it("returns values produced by the core", async () => {
    const core = fakeCore();
    const t = new TestTelemetry(core);

    expect(await t.getUserProfile()).toEqual({ fullName: "Ada" });
  });
});

describe("public API parity", () => {
  const shared = [
    "log", "flush", "shutdown", "trackErrors",
    "setUserId", "setUserProfile", "setUserDetails",
    "updateUserProfile", "getUserProfile", "clearUserProfile",
    "setUserName", "setUserContact", "identify",
  ];

  it("both platform classes inherit the shared delegation from TelemetryBase", () => {
    expect(Object.getPrototypeOf(TelemetryWeb.prototype)).toBe(TelemetryBase.prototype);
    expect(Object.getPrototypeOf(TelemetryNative.prototype)).toBe(TelemetryBase.prototype);
    for (const m of shared) {
      expect(typeof (TelemetryBase.prototype as any)[m]).toBe("function");
      expect(m in TelemetryWeb.prototype).toBe(true);
      expect(m in TelemetryNative.prototype).toBe(true);
    }
  });

  it("both expose the platform capture methods", () => {
    for (const m of ["getDeviceInfo", "getNetworkInfo", "trackFrameDrops", "trackNetworkRequests"]) {
      expect(typeof (TelemetryWeb.prototype as any)[m]).toBe("function");
      expect(typeof (TelemetryNative.prototype as any)[m]).toBe("function");
    }
  });

  // §5.2/#105 — `memory_usage` is native-only in v4; web does not expose the method at all.
  it("only native tracks memory", () => {
    expect(typeof (TelemetryNative.prototype as any).trackMemoryUsage).toBe("function");
    expect("trackMemoryUsage" in TelemetryWeb.prototype).toBe(false);
  });

  it("web has autoTrackNavigation; native has its screen/route extras", () => {
    expect(typeof (TelemetryWeb.prototype as any).autoTrackNavigation).toBe("function");
    for (const m of ["screenStart", "screenEnd", "trackRoute", "attachNavigation"]) {
      expect(typeof (TelemetryNative.prototype as any)[m]).toBe("function");
    }
  });
});
