import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TelemetryEvent } from "./core/telemetry";
import { memoryStore } from "./core/memoryStore";
import { QUIET_WINDOW_MS, LOADING_TIME_CAP_MS } from "./adapters/loadingTime";

// #97 on the wire, native. Real requests through the real XHR chokepoint, real view
// boundaries, and assertions only on what reaches the injected Sender. The mirror of this
// file is view.loadingTime.web.test.ts — the four outcomes are asserted identically on both
// builds, because §4.5.2's whole point is one shared module rather than two meanings behind
// one column name.

vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  Dimensions: { get: () => ({ width: 390, height: 844 }) },
  PixelRatio: { get: () => 3 },
  AppState: { currentState: "active", addEventListener: () => {} },
}));
vi.mock("react-native-get-random-values", () => ({}));
vi.mock("react-native-device-info", () => ({
  default: new Proxy({}, { get: () => async () => "x" }),
}));
vi.mock("@react-native-community/netinfo", () => ({
  default: { fetch: async () => ({ type: "wifi", isConnected: true }), addEventListener: () => {} },
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

const g = global as any;
const saved = { XMLHttpRequest: g.XMLHttpRequest, fetch: g.fetch, performance: g.performance };
const ENDPOINT = "https://collector.example.com/telemetry";
const T0 = new Date("2026-06-14T10:00:00.000Z").getTime();

function silenceConsole() {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
}

/**
 * RN's HTTP stack: `global.fetch` over XHR, which is why native patches XHR only (§4.4).
 * Completion is deferred so a test decides when the network goes quiet.
 */
function installRNHttp() {
  const pending: Array<() => void> = [];
  function XHR(this: any) { this.status = 200; this._l = {}; }
  XHR.prototype.open = function (this: any, m: string, u: string) { this._m = m; this._u = u; };
  XHR.prototype.send = function (this: any) {
    pending.push(() => (this._l["loadend"] || []).forEach((cb: any) => cb()));
  };
  XHR.prototype.addEventListener = function (this: any, t: string, cb: any) {
    (this._l[t] = this._l[t] || []).push(cb);
  };
  XHR.prototype.getResponseHeader = () => null;
  g.XMLHttpRequest = XHR;
  g.fetch = async (url: string, init?: any) => {
    const x = new g.XMLHttpRequest();
    x.open(init?.method ?? "GET", url);
    x.send(init?.body);
    return { status: 200 };
  };
  return { finishAll: () => pending.splice(0).forEach((f) => f()) };
}

/**
 * Drain the SDK's async plumbing without moving the clock: log() is async, the view
 * boundaries chain behind it, and the entry's runtime-ready seed sits behind a dynamic
 * import, which needs macrotasks and not just microtasks. `vi.setSystemTime` stays the only
 * thing that decides what `Date.now()` returns.
 */
async function settle() {
  for (let i = 0; i < 25; i++) await vi.advanceTimersByTimeAsync(0);
}

async function launch() {
  const { createTelemetry } = await import("./createTelemetry.native");
  const sent: TelemetryEvent[] = [];
  const t = createTelemetry({
    apiKey: "edge_lt",
    endpoint: ENDPOINT,
    sender: { send: async (e: TelemetryEvent[]) => { sent.push(...e); } },
    store: memoryStore(),
    batchSize: 500,
    flushIntervalMs: 0,
  });
  const inst = await (t as any).instancePromise;
  await settle();   // the runtime-ready seed is a promise chain in the ctor
  return { t, sent, inst };
}

const views = (sent: TelemetryEvent[]) =>
  sent.filter((e) => e.eventName === "view").map((e) => e.attributes!);

beforeEach(() => {
  silenceConsole();
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  g.XMLHttpRequest = saved.XMLHttpRequest;
  g.fetch = saved.fetch;
  g.performance = saved.performance;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("#97 view.loading_time on the wire (native) — the four outcomes", () => {
  it("settled: reports the completion, with the quiet window subtracted back out", async () => {
    const http = installRNHttp();
    const { t, sent, inst } = await launch();
    await inst.enterView("Home", "route");

    vi.setSystemTime(T0 + 100);
    const viewStart = T0;   // enterView re-stamped the launch view; its clock started at T0
    void g.fetch("https://api.example.com/a");
    await settle();

    vi.setSystemTime(T0 + 700);
    http.finishAll();
    await settle();

    vi.setSystemTime(T0 + 700 + QUIET_WINDOW_MS);
    await inst.enterView("Cart", "route");
    await t.flush();

    const v = views(sent)[0];
    expect(v["view.loading_time_outcome"]).toBe("settled");
    expect(v["view.loading_time"]).toBe(700 - (viewStart - T0));
    expect(v["view.request_count"]).toBe(1);
  });

  it("no_activity: a view that fetched nothing omits the key entirely — never 0", async () => {
    installRNHttp();
    const { t, sent, inst } = await launch();
    await inst.enterView("Home", "route");
    vi.setSystemTime(T0 + 5000);
    await inst.enterView("Cart", "route");
    await t.flush();

    const v = views(sent)[0];
    expect(v["view.loading_time_outcome"]).toBe("no_activity");
    // A 0 would make p75 track the cache-hit rate, so a backend caching win would render as
    // a frontend regression, reversed. Absence is the discipline (§4.5.2).
    expect(v).not.toHaveProperty("view.loading_time");
    expect(v["view.request_count"]).toBe(0);
  });

  it("capped: never settles inside 30 s — emits null, never 30000", async () => {
    installRNHttp();
    const { t, sent, inst } = await launch();
    await inst.enterView("Home", "route");

    vi.setSystemTime(T0 + 10);
    void g.fetch("https://api.example.com/slow");
    await settle();

    vi.setSystemTime(T0 + LOADING_TIME_CAP_MS);
    await inst.enterView("Cart", "route");
    await t.flush();

    const v = views(sent)[0];
    expect(v["view.loading_time_outcome"]).toBe("capped");
    expect(v).not.toHaveProperty("view.loading_time");   // 30 s and 90 s must not be one row
  });

  it("abandoned: the view exits with the network still busy, inside the cap", async () => {
    installRNHttp();
    const { t, sent, inst } = await launch();
    await inst.enterView("Home", "route");

    vi.setSystemTime(T0 + 50);
    void g.fetch("https://api.example.com/pending");
    await settle();

    vi.setSystemTime(T0 + 2000);
    await inst.enterView("Cart", "route");
    await t.flush();

    const v = views(sent)[0];
    expect(v["view.loading_time_outcome"]).toBe("abandoned");
    expect(v).not.toHaveProperty("view.loading_time");
  });
});

describe("#97 scope and attribution (native)", () => {
  it("the SDK's own collector POST never counts toward settle", async () => {
    const http = installRNHttp();
    const { t, sent, inst } = await launch();
    await inst.enterView("Home", "route");

    vi.setSystemTime(T0 + 100);
    void g.fetch(ENDPOINT, { method: "POST", body: "{}" });
    await settle();
    vi.setSystemTime(T0 + 300);
    http.finishAll();
    await settle();

    vi.setSystemTime(T0 + 5000);
    await inst.enterView("Cart", "route");
    await t.flush();

    const v = views(sent)[0];
    expect(v["view.loading_time_outcome"]).toBe("no_activity");
    expect(v["view.request_count"]).toBe(0);
    // and it is not on the wire as an http.request either — the #95 invariant still holds
    expect(sent.filter((e) => e.eventName === "http.request")).toHaveLength(0);
  });

  it("a request started in view A and finished in view B counts toward A", async () => {
    const http = installRNHttp();
    const { t, sent, inst } = await launch();
    await inst.enterView("A", "route");

    vi.setSystemTime(T0 + 100);
    void g.fetch("https://api.example.com/straddle");
    await settle();

    vi.setSystemTime(T0 + 500);
    await inst.enterView("B", "route");     // the boundary, with the request still in flight
    await settle();

    vi.setSystemTime(T0 + 900);
    http.finishAll();                        // lands in B, belongs to A
    await settle();

    vi.setSystemTime(T0 + 900 + QUIET_WINDOW_MS);
    await inst.enterView("C", "route");
    await t.flush();

    const [a, b] = views(sent);
    expect(a["view.name"]).toBe("A");
    expect(a["view.request_count"]).toBe(1);
    // A exited before its request landed, so A is abandoned — not settled by a later view's clock
    expect(a["view.loading_time_outcome"]).toBe("abandoned");

    expect(b["view.name"]).toBe("B");
    // B did not start it, so B is neither held open by it nor credited with it
    expect(b["view.request_count"]).toBe(0);
    expect(b["view.loading_time_outcome"]).toBe("no_activity");
  });

  it("a request starting during an already-quiet period does not reopen the view", async () => {
    const http = installRNHttp();
    const { t, sent, inst } = await launch();
    await inst.enterView("Home", "route");

    vi.setSystemTime(T0 + 100);
    void g.fetch("https://api.example.com/first");
    await settle();
    vi.setSystemTime(T0 + 600);
    http.finishAll();
    await settle();

    // A 30-second poller, long after the view went quiet.
    vi.setSystemTime(T0 + 20_000);
    void g.fetch("https://api.example.com/poll");
    await settle();
    vi.setSystemTime(T0 + 20_400);
    http.finishAll();
    await settle();

    vi.setSystemTime(T0 + 40_000);
    await inst.enterView("Cart", "route");
    await t.flush();

    const v = views(sent)[0];
    expect(v["view.loading_time_outcome"]).toBe("settled");
    expect(v["view.loading_time"]).toBe(600);   // not re-armed by the poll, and not capped
    expect(v["view.request_count"]).toBe(2);    // but the poll still counts as a request
  });
});

describe("#97 the initial_load runtime-ready seed (native)", () => {
  it("stays busy until performance.rnStartupTiming, then settles from it", async () => {
    g.performance = {
      ...saved.performance,
      rnStartupTiming: { executeJavaScriptBundleEntryPointEnd: T0 + 2000 },
    };
    const http = installRNHttp();
    const { t, sent, inst } = await launch();

    vi.setSystemTime(T0 + 100);
    void g.fetch("https://api.example.com/launch");
    await settle();
    vi.setSystemTime(T0 + 300);
    http.finishAll();                       // network quiet at 300ms, but the bundle is not ready
    await settle();

    vi.setSystemTime(T0 + 5000);
    await inst.enterView("Home", "route");   // ends the launch view — but it re-stamps, see below
    await t.flush();

    // The launch view is still unnamed, so `enterView` re-stamps it rather than exiting it
    // (§4.5.1). Move off it with a same-rung name to make its `view` row observable.
    await inst.enterView("Cart", "route");
    await t.flush();

    const v = views(sent)[0];
    expect(v["view.load_type"]).toBe("initial_load");
    expect(v["view.loading_time_outcome"]).toBe("settled");
    expect(v["view.loading_time"]).toBe(2000);   // the marker, not the 300ms completion
  });

  it("a runtime with no marker releases the gate rather than reporting abandoned forever", async () => {
    const http = installRNHttp();                 // node has no rnStartupTiming
    const { t, sent, inst } = await launch();

    vi.setSystemTime(T0 + 100);
    void g.fetch("https://api.example.com/launch");
    await settle();
    vi.setSystemTime(T0 + 400);
    http.finishAll();
    await settle();

    vi.setSystemTime(T0 + 400 + QUIET_WINDOW_MS);
    await inst.enterView("Home", "route");
    await inst.enterView("Cart", "route");
    await t.flush();

    const v = views(sent)[0];
    expect(v["view.load_type"]).toBe("initial_load");
    expect(v["view.loading_time_outcome"]).toBe("settled");
    expect(v["view.loading_time"]).toBe(400);
  });
});

describe("#97 the invariant the contract says to assert on arrival (native)", () => {
  it("loading_time_outcome === 'no_activity' if and only if view.request_count === 0", async () => {
    const http = installRNHttp();
    const { t, sent, inst } = await launch();

    // Walk one session through every outcome so the invariant is checked over all four.
    await inst.enterView("Settled", "route");
    void g.fetch("https://api.example.com/1");
    await settle();
    vi.setSystemTime(T0 + 200);
    http.finishAll();
    await settle();
    vi.setSystemTime(T0 + 200 + QUIET_WINDOW_MS);

    await inst.enterView("Quiet", "route");       // no requests at all
    vi.setSystemTime(T0 + 3000);

    await inst.enterView("Abandoned", "route");
    void g.fetch("https://api.example.com/2");
    await settle();
    vi.setSystemTime(T0 + 4000);

    await inst.enterView("Capped", "route");
    void g.fetch("https://api.example.com/3");
    await settle();
    vi.setSystemTime(T0 + 4000 + LOADING_TIME_CAP_MS);

    await inst.enterView("Last", "route");
    await t.flush();

    const rows = views(sent);
    expect(rows.map((v) => v["view.loading_time_outcome"]))
      .toEqual(["settled", "no_activity", "abandoned", "capped"]);
    for (const v of rows) {
      expect(v["view.loading_time_outcome"] === "no_activity",
        `${v["view.name"]}: ${v["view.loading_time_outcome"]} vs count ${v["view.request_count"]}`)
        .toBe(v["view.request_count"] === 0);
      // and only `settled` ever carries a number
      expect(v["view.loading_time_outcome"] === "settled")
        .toBe(Object.prototype.hasOwnProperty.call(v, "view.loading_time"));
    }
  });
});
