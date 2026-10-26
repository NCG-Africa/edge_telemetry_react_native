import { describe, it, expect, vi, afterEach } from "vitest";
import { runtimeReadyAt, processStartAt, toEpoch } from "./runtimeReady.native";

// §4.5.2's native seed. The field is stamped only once the bundle entry point finishes, and
// the common wiring constructs the SDK *inside* that entry point — so the read ordering is the
// whole behaviour here, not an implementation detail.

const g = global as any;
const saved = g.performance;
afterEach(() => { g.performance = saved; vi.useRealTimers(); });

const setTiming = (v: unknown) => {
  g.performance = { ...saved, rnStartupTiming: { executeJavaScriptBundleEntryPointEnd: v } };
};

describe("runtimeReadyAt (native)", () => {
  it("returns the bundle-evaluated marker when it is already stamped", async () => {
    setTiming(1_760_000_000_123);
    await expect(runtimeReadyAt()).resolves.toBe(1_760_000_000_123);
  });

  it("re-reads after a turn — an SDK built at module scope reads it before it is stamped", async () => {
    g.performance = { ...saved, rnStartupTiming: {} };
    const pending = runtimeReadyAt();
    // The entry point finishes, and only now does the runtime stamp the field.
    setTiming(1_760_000_000_456);
    await expect(pending).resolves.toBe(1_760_000_000_456);
  });

  it("resolves undefined rather than hanging when the runtime has no marker", async () => {
    g.performance = { ...saved };            // Old Architecture: no rnStartupTiming at all
    await expect(runtimeReadyAt()).resolves.toBeUndefined();
  });

  it("treats a zero or non-numeric marker as absent", async () => {
    setTiming(0);
    await expect(runtimeReadyAt()).resolves.toBeUndefined();
    setTiming("soon");
    await expect(runtimeReadyAt()).resolves.toBeUndefined();
  });

  it("survives performance being absent entirely", async () => {
    delete g.performance;
    await expect(runtimeReadyAt()).resolves.toBeUndefined();
  });
});

describe("toEpoch — the markers are monotonic-clock, not epoch", () => {
  it("shifts a performance.now()-clock marker onto Date.now()'s timeline", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_760_000_010_000);
    g.performance = { now: () => 50_000, rnStartupTiming: { startTime: 40_000 } };
    expect(processStartAt()).toBe(1_760_000_000_000);   // 10 s before now, not 1970
  });

  it("passes an epoch-sized value through and drops a missing clock", () => {
    expect(toEpoch(1_760_000_000_123)).toBe(1_760_000_000_123);
    g.performance = {};
    expect(toEpoch(40_000)).toBeUndefined();
  });
});
