import { describe, it, expect, vi, afterEach } from "vitest";
import { debug, setDebug } from "./debug";

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
