import { describe, it, expect, vi, afterEach } from "vitest";
import { debug, setDebug, isDev } from "./debug";

afterEach(() => { setDebug(false); vi.restoreAllMocks(); });

describe("debug gate", () => {
  it("is silent by default — routes nothing to console", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    debug.log("hi");
    debug.warn("careful");
    debug.error("boom");

    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("when enabled, forwards log/warn/error (with args) to console", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    setDebug(true);
    debug.log("a", 1);
    debug.warn("b");
    debug.error("c");

    expect(log).toHaveBeenCalledWith("a", 1);
    expect(warn).toHaveBeenCalledWith("b");
    expect(error).toHaveBeenCalledWith("c");
  });

  it("can be turned back off", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    setDebug(true);
    setDebug(false);
    debug.log("silent again");
    expect(log).not.toHaveBeenCalled();
  });
});

describe("isDev — the gate for dev-only config diagnostics (not the debug gate)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("trusts RN's __DEV__ boolean over anything else", () => {
    vi.stubGlobal("__DEV__", true);
    expect(isDev()).toBe(true);

    vi.stubGlobal("__DEV__", false);
    expect(isDev()).toBe(false);   // even though NODE_ENV is "test" under vitest
  });

  it("falls back to NODE_ENV where __DEV__ does not exist, and production is not dev", () => {
    vi.stubGlobal("__DEV__", undefined);
    vi.stubGlobal("process", { env: { NODE_ENV: "production" } });
    expect(isDev()).toBe(false);

    vi.stubGlobal("process", { env: { NODE_ENV: "development" } });
    expect(isDev()).toBe(true);

    // No signal at all: not dev, so a diagnostic stays quiet rather than guessing.
    vi.stubGlobal("process", { env: {} });
    expect(isDev()).toBe(false);
  });
});
