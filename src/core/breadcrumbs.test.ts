import { describe, it, expect } from "vitest";
import { BreadcrumbBuffer } from "./breadcrumbs";

describe("BreadcrumbBuffer (crash.breadcrumbs ring buffer)", () => {
  it("keeps at most the last 20 actions, evicting the oldest first", () => {
    const buf = new BreadcrumbBuffer(20);
    for (let i = 0; i < 25; i++) buf.add({ name: `e${i}` });

    const items = buf.list();
    expect(items).toHaveLength(20);
    expect(items[0]).toEqual({ name: "e5" });    // e0..e4 evicted
    expect(items[19]).toEqual({ name: "e24" });
  });

  it("serializes to a JSON string of the retained actions", () => {
    const buf = new BreadcrumbBuffer(3);
    buf.add({ name: "a" });
    buf.add({ name: "b" });

    expect(buf.toJSON()).toBe(JSON.stringify([{ name: "a" }, { name: "b" }]));
  });
});
