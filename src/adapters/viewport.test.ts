import { describe, it, expect } from "vitest";
import { viewportKeys } from "./viewport";

describe("viewportKeys (§3.3's four viewport keys, #108)", () => {
  it("converts logical units to physical pixels", () => {
    expect(viewportKeys(390, 844, 3)).toEqual({
      screen_density: 3,
      screen_width_px: 1170,
      screen_height_px: 2532,
      orientation: "portrait",
    });
  });

  it("reports landscape only when width strictly exceeds height", () => {
    expect(viewportKeys(800, 600, 2).orientation).toBe("landscape");
    expect(viewportKeys(600, 800, 2).orientation).toBe("portrait");
    expect(viewportKeys(700, 700, 2).orientation).toBe("portrait");   // square, §3.3 has 2 values
  });

  it("rounds a fractional density rather than shipping a fractional pixel count", () => {
    const v = viewportKeys(375, 812, 1.5);
    expect(v.screen_width_px).toBe(563);
    expect(Number.isInteger(v.screen_height_px)).toBe(true);
  });
});
