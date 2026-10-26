import { describe, it, expect } from "vitest";
import { SpanRegistry, spanAttributes, taskName, MAX_OPEN_SPANS } from "./manualSpans";

describe("manual span bookkeeping (#164)", () => {
  it("taskName: unnormalized, capped at 255, blank is inert", () => {
    expect(taskName("Step 2 of 3")).toBe("Step 2 of 3");
    expect(taskName("x".repeat(300))).toHaveLength(255);
    expect(taskName("  ")).toBeUndefined();
    expect(taskName(42)).toBeUndefined();
  });

  it("spanAttributes drops the reserved namespaces, flattened or nested", () => {
    expect(spanAttributes({ "task.name": 1, task: {}, "span.id": 1, trace: 1, "parent.span.id": 1, "rum.action.id": 1, tasks: 1, ok: 2 }))
      .toEqual({ tasks: 1, ok: 2 });
    expect(spanAttributes(undefined)).toBeUndefined();
  });

  it("supersedes by name, caps at 32, and only the live handle closes", () => {
    const r = new SpanRegistry();
    const a = r.start("x", 1)!;
    const b = r.start("x", 2)!;
    expect(r.take("x", a)).toBeUndefined();
    expect(r.take("x", b)).toBe(b);
    for (let i = 0; i < MAX_OPEN_SPANS; i++) expect(r.start(`s${i}`, i)).toBeDefined();
    expect(r.start("over", 0)).toBeUndefined();
    expect(r.start("s0", 9)).toBeDefined();   // superseding is not growth
  });

  it("round-trips frozen spans through the record, survives a cyclic attribute and junk", () => {
    const r = new SpanRegistry();
    const cyclic: any = {}; cyclic.self = cyclic;
    Object.assign(r.start("a", 1, { n: 1 })!, { sessionId: "s1", viewId: "v", sessionStart: 0, keys: {} });
    Object.assign(r.start("b", 2, { cyclic })!, { sessionId: "s1", viewId: "v", sessionStart: 0, keys: {} });
    r.start("pending", 3);   // not frozen yet — not persisted
    const json = JSON.parse(JSON.stringify(r.toJSON()));

    const back = new SpanRegistry();
    back.restore([...json, { name: 1 }, null]);
    const taken = back.takeSession("s1");
    expect(taken.map((s) => [s.name, s.attrs])).toEqual([["a", { n: 1 }], ["b", undefined]]);
    expect(back.toJSON()).toEqual([]);
  });
});
