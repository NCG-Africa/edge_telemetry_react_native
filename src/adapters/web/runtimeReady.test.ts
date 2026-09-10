import { describe, it, expect, vi, afterEach } from "vitest";
import { runtimeReadyAt } from "./runtimeReady.web";
import { LOADING_TIME_CAP_MS } from "../loadingTime";

// §4.5.2's web seed. Every path must end in a resolved promise: a gate that never opens makes
// every launch report `abandoned`, which is the exact failure this module exists to avoid.

const g = global as any;
const saved = { window: g.window, document: g.document, performance: g.performance };
afterEach(() => {
  g.window = saved.window; g.document = saved.document; g.performance = saved.performance;
  vi.useRealTimers();
});

function stubWindow() {
  const load: Array<() => void> = [];
  g.window = {
    addEventListener: (type: string, fn: () => void) => { if (type === "load") load.push(fn); },
  };
  return { fire: () => load.splice(0).forEach((fn) => fn()) };
}

describe("runtimeReadyAt (web)", () => {
  it("returns loadEventEnd from navigation timing, converted to epoch ms", async () => {
    stubWindow();
    g.performance = { timeOrigin: 1_760_000_000_000, getEntriesByType: () => [{ loadEventEnd: 1234 }] };
    await expect(runtimeReadyAt()).resolves.toBe(1_760_000_001_234);
  });

  it("falls back to the legacy performance.timing entry, which is already epoch ms", async () => {
    stubWindow();
    g.performance = { getEntriesByType: () => [], timing: { loadEventEnd: 1_760_000_009_000 } };
    await expect(runtimeReadyAt()).resolves.toBe(1_760_000_009_000);
  });

  it("waits for the load event, then stamps now when the entry is still zero", async () => {
    const w = stubWindow();
    g.performance = { getEntriesByType: () => [{ loadEventEnd: 0 }] };
    g.document = { readyState: "loading" };
    vi.useFakeTimers();
    vi.setSystemTime(1_760_000_005_000);

    const pending = runtimeReadyAt();
    w.fire();   // loadEventEnd is stamped *after* the load handlers run, so it is still 0 here
    await expect(pending).resolves.toBe(1_760_000_005_000);
  });

  it("releases immediately when the document is already complete but has no entry", async () => {
    stubWindow();
    g.performance = { getEntriesByType: () => [] };
    g.document = { readyState: "complete" };
    await expect(runtimeReadyAt()).resolves.toBeUndefined();
  });

  it("gives up at the cap rather than pending forever when load never fires", async () => {
    stubWindow();
    g.performance = { getEntriesByType: () => [] };
    g.document = { readyState: "loading" };
    vi.useFakeTimers();

    const pending = runtimeReadyAt();
    await vi.advanceTimersByTimeAsync(LOADING_TIME_CAP_MS);
    // Past the cap the launch view is capped anyway, so there is nothing left to wait for —
    // and a gate left shut would report `abandoned` for the life of the process.
    await expect(pending).resolves.toBeUndefined();
  });

  it("resolves undefined off-browser rather than throwing", async () => {
    delete g.window;
    await expect(runtimeReadyAt()).resolves.toBeUndefined();
  });
});
