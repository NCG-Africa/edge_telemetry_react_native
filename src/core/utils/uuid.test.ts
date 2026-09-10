import { describe, it, expect, vi } from "vitest";
import { randomHex } from "./uuid";

describe("randomHex", () => {
  it("returns `length` lowercase hex chars", () => {
    expect(randomHex()).toMatch(/^[0-9a-f]{16}$/);
    expect(randomHex(8)).toMatch(/^[0-9a-f]{8}$/);
    expect(randomHex(7)).toMatch(/^[0-9a-f]{7}$/);   // odd lengths are exact, not rounded up
  });

  it("draws from crypto.getRandomValues, not Math.random", () => {
    const spy = vi.spyOn(globalThis.crypto, "getRandomValues");
    randomHex();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("does not repeat", () => {
    expect(new Set(Array.from({ length: 200 }, () => randomHex())).size).toBe(200);
  });
});
