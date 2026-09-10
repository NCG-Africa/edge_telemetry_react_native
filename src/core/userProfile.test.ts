import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { buildProfileAttributes } from "./userProfile";

afterEach(() => vi.restoreAllMocks());
// The other tests trip the same overflow path; silence them so they cannot be mistaken
// for the once-per-process assertion below.
beforeEach(() => { vi.spyOn(console, "warn").mockImplementation(() => {}); });

describe("buildProfileAttributes (§4.10)", () => {
  it("caps name/email at 255 and phone at 50", () => {
    const a = buildProfileAttributes({
      fullName: "n".repeat(300), email: "e".repeat(300), phone: "p".repeat(80),
    });
    expect(a["user.name"]).toHaveLength(255);
    expect(a["user.email"]).toHaveLength(255);
    expect(a["user.phone"]).toHaveLength(50);
  });

  it("omits absent fields and ships no counter when nothing dropped", () => {
    const a = buildProfileAttributes({ fullName: "Ada" });
    expect(a).toEqual({ "user.name": "Ada" });
    expect("user.custom_dropped" in a).toBe(false);
  });

  it("emits no deleted keys — fullName/firstName/lastName/avatar/createdAt/updatedAt", () => {
    const a = buildProfileAttributes({
      fullName: "Ada", firstName: "A", lastName: "L", avatar: "u",
      createdAt: 1, updatedAt: 2,
    });
    expect(Object.keys(a)).toEqual(["user.name"]);
  });

  it("drops a cyclic custom value instead of throwing, and counts it", () => {
    const cyclic: any = { a: 1 };
    cyclic.self = cyclic;
    const a = buildProfileAttributes({ customAttributes: { plan: "pro", cyclic } });
    expect(a["user.custom.plan"]).toBe("pro");
    expect("user.custom.cyclic" in a).toBe(false);
    expect(a["user.custom_dropped"]).toBe(1);
  });

  it("stringifies an array rather than leaking a non-primitive into the bag", () => {
    const a = buildProfileAttributes({ customAttributes: { tags: ["a", "b"], nested: { x: 1 } } });
    expect(a["user.custom.tags"]).toBe('["a","b"]');
    expect(a["user.custom.nested"]).toBe('{"x":1}');
  });

  it("bounds the bag at 64 keys, 64-char keys and 255-char values", () => {
    const custom: Record<string, any> = { ["k".repeat(65)]: "x", long: "v".repeat(300) };
    for (let i = 0; i < 70; i++) custom[`k${i}`] = i;
    const a = buildProfileAttributes({ customAttributes: custom });
    const bag = Object.keys(a).filter((k) => k.startsWith("user.custom."));
    expect(bag).toHaveLength(64);
    expect(a["user.custom_dropped"]).toBe(72 - 64);
    expect(a["user.custom." + "k".repeat(65)]).toBeUndefined();
    // the over-long value was kept, truncated — truncation is not a drop
    expect(a["user.custom.long"]).toHaveLength(255);
  });

  it("passes consumer key casing through verbatim", () => {
    const a = buildProfileAttributes({ customAttributes: { PlanTier: "Gold" } });
    expect(a["user.custom.PlanTier"]).toBe("Gold");
  });

  it("warns once in dev on overflow and never throws", async () => {
    // A fresh module instance: the once-per-process flag is module state, and this is the
    // only test that reads it. Resetting it through an exported setter would put a
    // test-only seam in shipped code.
    vi.resetModules();
    const fresh = await import("./userProfile");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    (globalThis as any).__DEV__ = true;
    try {
      const cyclic: any = {}; cyclic.self = cyclic;
      expect(() => fresh.buildProfileAttributes({ customAttributes: { cyclic } })).not.toThrow();
      fresh.buildProfileAttributes({ customAttributes: { cyclic } });
    } finally {
      delete (globalThis as any).__DEV__;
    }
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
