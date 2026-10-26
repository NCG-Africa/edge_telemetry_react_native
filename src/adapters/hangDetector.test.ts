import { describe, it, expect } from "vitest";
import { stallMs, HANG_TICK_MS } from "./hangDetector";

describe("stallMs (#165)", () => {
  const t = (late: number) => stallMs(1000, 1000 + HANG_TICK_MS + late);
  it("books only the lateness past the schedule, from 2 s up to 60 s inclusive", () => {
    expect(t(0)).toBeUndefined();
    expect(t(1999)).toBeUndefined();
    expect(t(2000)).toBe(2000);
    expect(t(4321.6)).toBe(4322);
    expect(t(60000)).toBe(60000);
  });
  it("drops a suspension over 60 s, and a clock that went backwards", () => {
    expect(t(60001)).toBeUndefined();
    expect(stallMs(5000, 1000)).toBeUndefined();
  });
});
