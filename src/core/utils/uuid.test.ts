import { describe, it, expect } from "vitest";
import { generateId } from "./uuid.web";

// Smoke test: proves the Vitest harness compiles + runs TS from src/.
// Deeper telemetry behavior tests land per-issue (see plan).
describe("generateId", () => {
  it("returns a non-empty string", () => {
    expect(typeof generateId()).toBe("string");
    expect(generateId().length).toBeGreaterThan(0);
  });

  it("returns distinct values across calls", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});
