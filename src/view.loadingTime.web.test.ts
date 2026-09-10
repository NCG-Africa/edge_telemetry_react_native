import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTelemetry } from "./createTelemetry.web";
import type { TelemetryEvent } from "./core/telemetry";
import { memoryStore } from "./core/memoryStore";
import { QUIET_WINDOW_MS, LOADING_TIME_CAP_MS } from "./adapters/loadingTime";

// #97 on the wire, web — the mirror of view.loadingTime.native.test.ts. The four outcomes are
// asserted identically on both builds on purpose: §4.5.2 runs ONE shared module precisely so
// that `view.loading_time` cannot become two different meanings behind one column name.

const g = global as any;
const saved = { window: g.window, XMLHttpRequest: g.XMLHttpRequest };
const ENDPOINT = "https://collector.example.com/telemetry";
const T0 = new Date("2026-06-14T10:00:00.000Z").getTime();

function silenceConsole() {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
}

/**
 * A browser `fetch` that resolves only when a test says so, plus the `load` listener the
 * runtime-ready seed waits on. Browser fetch is native and not XHR-backed, so on web it is a
 * channel of its own (§4.4) — this drives that one.
 */
function installWebFetch() {
  const pending: Array<(v: any) => void> = [];
  const loadListeners: Array<() => void> = [];
  g.window = {
    fetch: () => new Promise((resolve) => pending.push(resolve)),
    addEventListener: (type: string, fn: () => void) => {
      if (type === "load") loadListeners.push(fn);
    },
  };
  return {
    finishAll: () => pending.splice(0).forEach((r) => r({ status: 200, headers: { get: () => null } })),
    fireLoad: () => loadListeners.splice(0).forEach((fn) => fn()),
  };
}

/** Drain the async plumbing — including the dynamic import behind the seed — without moving the clock. */
async function settle() {
  for (let i = 0; i < 25; i++) await vi.advanceTimersByTimeAsync(0);
}

async function launch() {
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
  await settle();
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
  g.window = saved.window;
  g.XMLHttpRequest = saved.XMLHttpRequest;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("#97 view.loading_time on the wire (web) — the four outcomes", () => {
  it("settled: reports the completion, with the quiet window subtracted back out", async () => {
    const http = installWebFetch();
    const { t, sent, inst } = await launch();
    http.fireLoad();                       // release the initial_load gate
    await settle();
    await inst.enterView("/home", "url");

    vi.setSystemTime(T0 + 100);
    void g.window.fetch("https://api.example.com/a");
    await settle();
    vi.setSystemTime(T0 + 700);
    http.finishAll();
    await settle();

    vi.setSystemTime(T0 + 700 + QUIET_WINDOW_MS);
    await inst.enterView("/cart", "url");
    await t.flush();

    const v = views(sent)[0];
    expect(v["view.loading_time_outcome"]).toBe("settled");
    expect(v["view.loading_time"]).toBe(700);
    expect(v["view.request_count"]).toBe(1);
  });

  it("no_activity: a view that fetched nothing omits the key entirely — never 0", async () => {
    const http = installWebFetch();
    const { t, sent, inst } = await launch();
    http.fireLoad();
    await settle();
    await inst.enterView("/home", "url");

    vi.setSystemTime(T0 + 5000);
    await inst.enterView("/cart", "url");
    await t.flush();

    const v = views(sent)[0];
    expect(v["view.loading_time_outcome"]).toBe("no_activity");
    expect(v).not.toHaveProperty("view.loading_time");
    expect(v["view.request_count"]).toBe(0);
  });

  it("capped: never settles inside 30 s — emits null, never 30000", async () => {
    const http = installWebFetch();
    const { t, sent, inst } = await launch();
    http.fireLoad();
    await settle();
    await inst.enterView("/home", "url");

    vi.setSystemTime(T0 + 10);
    void g.window.fetch("https://api.example.com/slow");
    await settle();

    vi.setSystemTime(T0 + LOADING_TIME_CAP_MS);
    await inst.enterView("/cart", "url");
    await t.flush();

    const v = views(sent)[0];
    expect(v["view.loading_time_outcome"]).toBe("capped");
    expect(v).not.toHaveProperty("view.loading_time");
  });

  it("abandoned: the view exits with the network still busy, inside the cap", async () => {
    const http = installWebFetch();
    const { t, sent, inst } = await launch();
    http.fireLoad();
    await settle();
    await inst.enterView("/home", "url");

    vi.setSystemTime(T0 + 50);
    void g.window.fetch("https://api.example.com/pending");
    await settle();

    vi.setSystemTime(T0 + 2000);
    await inst.enterView("/cart", "url");
    await t.flush();

    const v = views(sent)[0];
    expect(v["view.loading_time_outcome"]).toBe("abandoned");
    expect(v).not.toHaveProperty("view.loading_time");
  });
});

describe("#97 scope and attribution (web)", () => {
  it("the SDK's own collector POST never counts toward settle", async () => {
    const http = installWebFetch();
    const { t, sent, inst } = await launch();
    http.fireLoad();
    await settle();
    await inst.enterView("/home", "url");

    vi.setSystemTime(T0 + 100);
    void g.window.fetch(ENDPOINT, { method: "POST", body: "{}" });
    await settle();
    vi.setSystemTime(T0 + 300);
    http.finishAll();
    await settle();

    vi.setSystemTime(T0 + 5000);
    await inst.enterView("/cart", "url");
    await t.flush();

    const v = views(sent)[0];
    expect(v["view.loading_time_outcome"]).toBe("no_activity");
    expect(v["view.request_count"]).toBe(0);
    expect(sent.filter((e) => e.eventName === "http.request")).toHaveLength(0);
  });

  it("a request started in view A and finished in view B counts toward A", async () => {
    const http = installWebFetch();
    const { t, sent, inst } = await launch();
    http.fireLoad();
    await settle();
    await inst.enterView("/a", "url");

    vi.setSystemTime(T0 + 100);
    void g.window.fetch("https://api.example.com/straddle");
    await settle();

    vi.setSystemTime(T0 + 500);
    await inst.enterView("/b", "url");
    await settle();

    vi.setSystemTime(T0 + 900);
    http.finishAll();
    await settle();

    vi.setSystemTime(T0 + 900 + QUIET_WINDOW_MS);
    await inst.enterView("/c", "url");
    await t.flush();

    const [a, b] = views(sent);
    expect(a["view.name"]).toBe("/a");
    expect(a["view.request_count"]).toBe(1);
    expect(a["view.loading_time_outcome"]).toBe("abandoned");

    expect(b["view.name"]).toBe("/b");
    expect(b["view.request_count"]).toBe(0);
    expect(b["view.loading_time_outcome"]).toBe("no_activity");
  });

  it("a request starting during an already-quiet period does not reopen the view", async () => {
    const http = installWebFetch();
    const { t, sent, inst } = await launch();
    http.fireLoad();
    await settle();
    await inst.enterView("/home", "url");

    vi.setSystemTime(T0 + 100);
    void g.window.fetch("https://api.example.com/first");
    await settle();
    vi.setSystemTime(T0 + 600);
    http.finishAll();
    await settle();

    vi.setSystemTime(T0 + 20_000);
    void g.window.fetch("https://api.example.com/poll");
    await settle();
    vi.setSystemTime(T0 + 20_400);
    http.finishAll();
    await settle();

    vi.setSystemTime(T0 + 40_000);
    await inst.enterView("/cart", "url");
    await t.flush();

    const v = views(sent)[0];
    expect(v["view.loading_time_outcome"]).toBe("settled");
    expect(v["view.loading_time"]).toBe(600);
    expect(v["view.request_count"]).toBe(2);
  });
});

describe("#97 the initial_load runtime-ready seed (web)", () => {
  it("stays busy until the document's load marker, then settles from it", async () => {
    const http = installWebFetch();
    const { t, sent, inst } = await launch();

    vi.setSystemTime(T0 + 100);
    void g.window.fetch("https://api.example.com/launch");
    await settle();
    vi.setSystemTime(T0 + 300);
    http.finishAll();                    // quiet at 300ms, but the document has not loaded
    await settle();

    // The load event is the marker, and it is what the launch view has been waiting on.
    vi.setSystemTime(T0 + 2000);
    http.fireLoad();
    await settle();

    vi.setSystemTime(T0 + 5000);
    await inst.enterView("/home", "url");    // the launch view is unnamed, so this re-stamps it
    await inst.enterView("/cart", "url");    // a same-rung move is what actually ends it
    await t.flush();

    const v = views(sent)[0];
    expect(v["view.load_type"]).toBe("initial_load");
    expect(v["view.loading_time_outcome"]).toBe("settled");
    expect(v["view.loading_time"]).toBe(2000);   // the marker, not the 300ms completion
  });

  it("a load event arriving after a route change does not inflate the successor", async () => {
    const http = installWebFetch();
    const { t, sent, inst } = await launch();

    // The launch view is still waiting on `load` when the user navigates away.
    vi.setSystemTime(T0 + 400);
    await inst.enterView("/home", "url");    // unnamed launch view — re-stamps
    await inst.enterView("/cart", "url");    // and this is the boundary that ends it
    await settle();

    // Now the page finally finishes loading, well into the successor's life.
    vi.setSystemTime(T0 + 9000);
    http.fireLoad();
    await settle();

    vi.setSystemTime(T0 + 9100);
    void g.window.fetch("https://api.example.com/in-cart");
    await settle();
    vi.setSystemTime(T0 + 9300);
    http.finishAll();
    await settle();

    vi.setSystemTime(T0 + 9300 + QUIET_WINDOW_MS);
    await inst.enterView("/checkout", "url");
    await t.flush();

    const [launchView, cart] = views(sent);
    // The launch view genuinely was abandoned mid-load — the user left before it finished.
    expect(launchView["view.load_type"]).toBe("initial_load");
    expect(launchView["view.loading_time_outcome"]).toBe("no_activity");

    // The successor was never gated on the marker, so it must not be floored at it: its
    // request settled 300ms in, and 9300ms would be the page's load cost, not the screen's.
    expect(cart["view.name"]).toBe("/cart");
    expect(cart["view.loading_time_outcome"]).toBe("settled");
    expect(cart["view.loading_time"]).toBe(9300 - 400);
  });

  it("a document already complete releases the gate rather than reporting abandoned forever", async () => {
    const http = installWebFetch();
    const { t, sent, inst } = await launch();
    http.fireLoad();                     // resolves with `Date.now()` — we are in the load event
    await settle();

    vi.setSystemTime(T0 + 100);
    void g.window.fetch("https://api.example.com/launch");
    await settle();
    vi.setSystemTime(T0 + 400);
    http.finishAll();
    await settle();

    vi.setSystemTime(T0 + 400 + QUIET_WINDOW_MS);
    await inst.enterView("/home", "url");
    await inst.enterView("/cart", "url");
    await t.flush();

    const v = views(sent)[0];
    expect(v["view.load_type"]).toBe("initial_load");
    expect(v["view.loading_time_outcome"]).toBe("settled");
    expect(v["view.loading_time"]).toBe(400);
  });
});

describe("#97 the invariant the contract says to assert on arrival (web)", () => {
  it("loading_time_outcome === 'no_activity' if and only if view.request_count === 0", async () => {
    const http = installWebFetch();
    const { t, sent, inst } = await launch();
    http.fireLoad();
    await settle();

    await inst.enterView("/settled", "url");
    void g.window.fetch("https://api.example.com/1");
    await settle();
    vi.setSystemTime(T0 + 200);
    http.finishAll();
    await settle();
    vi.setSystemTime(T0 + 200 + QUIET_WINDOW_MS);

    await inst.enterView("/quiet", "url");
    vi.setSystemTime(T0 + 3000);

    await inst.enterView("/abandoned", "url");
    void g.window.fetch("https://api.example.com/2");
    await settle();
    vi.setSystemTime(T0 + 4000);

    await inst.enterView("/capped", "url");
    void g.window.fetch("https://api.example.com/3");
    await settle();
    vi.setSystemTime(T0 + 4000 + LOADING_TIME_CAP_MS);

    await inst.enterView("/last", "url");
    await t.flush();

    const rows = views(sent);
    // The identical sequence, and the identical verdicts, as the native mirror.
    expect(rows.map((v) => v["view.loading_time_outcome"]))
      .toEqual(["settled", "no_activity", "abandoned", "capped"]);
    for (const v of rows) {
      expect(v["view.loading_time_outcome"] === "no_activity",
        `${v["view.name"]}: ${v["view.loading_time_outcome"]} vs count ${v["view.request_count"]}`)
        .toBe(v["view.request_count"] === 0);
      expect(v["view.loading_time_outcome"] === "settled")
        .toBe(Object.prototype.hasOwnProperty.call(v, "view.loading_time"));
    }
  });
});
