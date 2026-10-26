import { describe, it, expect } from "vitest";
import { boundCrumb, BreadcrumbBuffer } from "./breadcrumbs";

describe("boundCrumb (#167)", () => {
  const at = new Date("2026-06-14T10:00:00.000Z");
  it("caps name at 64, keeps the first 8 keys, values by the bag rule capped at 255", () => {
    const cyclic: any = {}; cyclic.self = cyclic;
    const data = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i}`, i]));
    Object.assign(data, { k0: "x".repeat(300), k1: { a: [1] }, k2: cyclic, k3: null, k4: true });
    const c = boundCrumb("n".repeat(80), data, at);
    expect(c.name).toHaveLength(64);
    expect(c).toMatchObject({ k1: '{"a":[1]}', k4: true, k5: 5, k7: 7, timestamp: at.toISOString() });
    expect(c.k0).toHaveLength(255);
    expect(c).not.toHaveProperty("k2");   // cannot be stringified: dropped
    expect(c).not.toHaveProperty("k3");
    expect(c).not.toHaveProperty("k8");
  });
  it("data cannot rename or re-time the crumb", () => {
    expect(boundCrumb("real", { name: "forged", timestamp: "x" }, at)).toEqual({ name: "real", timestamp: at.toISOString() });
  });
  it("the ring keeps the last 20", () => {
    const b = new BreadcrumbBuffer(20);
    for (let i = 0; i < 25; i++) b.add(boundCrumb(`c${i}`, undefined, at));
    expect(b.list().map((c) => c.name)).toEqual(Array.from({ length: 20 }, (_, i) => `c${i + 5}`));
  });
});
