import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NetworkSettle, QUIET_WINDOW_MS, LOADING_TIME_CAP_MS } from "./loadingTime";

// §4.5.2 in isolation: one shared module, so web and native cannot drift into two meanings
// behind one column name. Time is fake timers throughout — every rule here is a time rule.

const T0 = new Date("2026-06-14T10:00:00.000Z").getTime();
const at = (ms: number) => T0 + ms;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

describe("NetworkSettle — outcomes", () => {
  it("no_activity: a view that started no requests reports null, never 0", () => {
    const s = new NetworkSettle(T0);
    expect(s.resolve(at(5000))).toEqual({ loadingTime: null, outcome: "no_activity" });
    expect(s.requestCount).toBe(0);
  });

  it("settled: the quiet window is subtracted back out of the reported number", () => {
    const s = new NetworkSettle(T0);
    const done = s.requestStarted(at(100));
    done(at(700));                       // network is quiet from 700ms

    // Detected only once the window has elapsed, but the number reported is the completion.
    expect(s.resolve(at(700 + QUIET_WINDOW_MS))).toEqual({ loadingTime: 700, outcome: "settled" });
  });

  it("settled: the last of several overlapping requests is what settles the view", () => {
    const s = new NetworkSettle(T0);
    const a = s.requestStarted(at(50));
    const b = s.requestStarted(at(120));
    a(at(400));
    b(at(1500));
    expect(s.requestCount).toBe(2);
    expect(s.resolve(at(1500 + QUIET_WINDOW_MS))).toEqual({ loadingTime: 1500, outcome: "settled" });
  });

  it("abandoned: the view exits while a request is still in flight", () => {
    const s = new NetworkSettle(T0);
    s.requestStarted(at(100));
    expect(s.resolve(at(2000))).toEqual({ loadingTime: null, outcome: "abandoned" });
  });

  it("abandoned: the view exits inside the quiet window, before settle is observable", () => {
    const s = new NetworkSettle(T0);
    const done = s.requestStarted(at(100));
    done(at(500));
    expect(s.resolve(at(500 + QUIET_WINDOW_MS - 1))).toEqual({ loadingTime: null, outcome: "abandoned" });
  });

  it("capped: never settles inside 30 s — emits null, never the cap", () => {
    const s = new NetworkSettle(T0);
    s.requestStarted(at(10));
    const r = s.resolve(at(LOADING_TIME_CAP_MS));
    expect(r.outcome).toBe("capped");
    expect(r.loadingTime).toBeNull();       // 30000 and 90000 must not become the same row
  });

  it("capped: settles, but past the cap", () => {
    const s = new NetworkSettle(T0);
    const done = s.requestStarted(at(10));
    done(at(LOADING_TIME_CAP_MS + 5000));
    expect(s.resolve(at(LOADING_TIME_CAP_MS + 5000 + QUIET_WINDOW_MS)))
      .toEqual({ loadingTime: null, outcome: "capped" });
  });

  it("a request starting during an already-quiet period does not reopen the view", () => {
    const s = new NetworkSettle(T0);
    const first = s.requestStarted(at(100));
    first(at(600));

    // A 30-second poller firing long after settle: it counts as a request, but it must not
    // re-arm the view, or loading_time never resolves for a screen that polls.
    const poll = s.requestStarted(at(30_000));
    poll(at(30_400));

    expect(s.requestCount).toBe(2);        // request_count counts every request started here
    expect(s.resolve(at(60_000))).toEqual({ loadingTime: 600, outcome: "settled" });
  });

  it("a completion callback is idempotent — a double-fire cannot unbalance the in-flight count", () => {
    const s = new NetworkSettle(T0);
    const a = s.requestStarted(at(0));
    const b = s.requestStarted(at(0));
    a(at(100));
    a(at(900));                            // XHR loadend firing twice, or a retry wrapper
    expect(s.resolve(at(5000)).outcome).toBe("abandoned");   // b is still in flight
    b(at(1000));
    expect(s.resolve(at(1000 + QUIET_WINDOW_MS))).toEqual({ loadingTime: 1000, outcome: "settled" });
  });
});

describe("NetworkSettle — the initial_load runtime-ready seed", () => {
  it("stays busy until the runtime-ready marker arrives, however quiet the network is", () => {
    const s = new NetworkSettle(T0, { awaitRuntimeReady: true });
    const done = s.requestStarted(at(100));
    done(at(300));

    // Quiet, but the runtime is not ready — the view has not finished loading.
    expect(s.resolve(at(5000))).toEqual({ loadingTime: null, outcome: "abandoned" });

    s.seedRuntimeReady(at(2000));
    expect(s.resolve(at(5000))).toEqual({ loadingTime: 2000, outcome: "settled" });
  });

  it("the marker is a floor, not a source of activity — a zero-request launch is still no_activity", () => {
    const s = new NetworkSettle(T0, { awaitRuntimeReady: true });
    s.seedRuntimeReady(at(800));
    // §4.5.2's free invariant is `no_activity` ⇔ `request_count = 0`, and it wins over reading
    // the seed as activity: a launch that fetched nothing has no loading time to report.
    expect(s.resolve(at(5000))).toEqual({ loadingTime: null, outcome: "no_activity" });
  });

  it("a request finishing after the marker still decides the number", () => {
    const s = new NetworkSettle(T0, { awaitRuntimeReady: true });
    s.seedRuntimeReady(at(200));
    const done = s.requestStarted(at(100));
    done(at(1400));
    expect(s.resolve(at(1400 + QUIET_WINDOW_MS))).toEqual({ loadingTime: 1400, outcome: "settled" });
  });

  it("releases the gate when the platform has no marker to give", () => {
    const s = new NetworkSettle(T0, { awaitRuntimeReady: true });
    const done = s.requestStarted(at(100));
    done(at(300));
    s.seedRuntimeReady(undefined);   // Old Architecture, or a runtime that omits the marker
    expect(s.resolve(at(5000))).toEqual({ loadingTime: 300, outcome: "settled" });
  });

  it("a non-initial view is never gated on a marker", () => {
    const s = new NetworkSettle(T0);
    const done = s.requestStarted(at(100));
    done(at(300));
    expect(s.resolve(at(5000))).toEqual({ loadingTime: 300, outcome: "settled" });
  });
});

describe("NetworkSettle — the invariant the contract says to assert on arrival", () => {
  it("outcome === no_activity if and only if requestCount === 0", () => {
    const cases: NetworkSettle[] = [];

    cases.push(new NetworkSettle(T0));                                    // nothing at all
    const gated = new NetworkSettle(T0, { awaitRuntimeReady: true });
    gated.seedRuntimeReady(at(100));
    cases.push(gated);                                                    // seeded, no requests

    const settled = new NetworkSettle(T0);
    settled.requestStarted(at(0))(at(100));
    cases.push(settled);

    const inFlight = new NetworkSettle(T0);
    inFlight.requestStarted(at(0));
    cases.push(inFlight);

    const capped = new NetworkSettle(T0);
    capped.requestStarted(at(0));
    cases.push(capped);

    for (const s of cases) {
      const r = s.resolve(at(LOADING_TIME_CAP_MS + QUIET_WINDOW_MS));
      expect(r.outcome === "no_activity", `outcome ${r.outcome} vs count ${s.requestCount}`)
        .toBe(s.requestCount === 0);
    }
  });

  it("only `settled` ever carries a number; the other three are always null", () => {
    const built: NetworkSettle[] = [];
    const settled = new NetworkSettle(T0); settled.requestStarted(at(0))(at(10)); built.push(settled);
    const abandoned = new NetworkSettle(T0); abandoned.requestStarted(at(0)); built.push(abandoned);
    built.push(new NetworkSettle(T0));

    for (const s of built) {
      const r = s.resolve(at(2000));
      expect(r.outcome === "settled").toBe(r.loadingTime !== null);
    }
  });
});
