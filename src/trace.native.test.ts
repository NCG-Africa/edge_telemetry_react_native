import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TelemetryEvent } from "./core/telemetry";
import { memoryStore } from "./core/memoryStore";
import { SESSION_KEY } from "./core/telemetry";
import type { Store } from "./core/store";

// #98 native mirror of trace.web.test.ts. Platform APIs are module-stubbed; the assertions
// are on the TelemetryEvent[] that reaches the injected Sender, never on manager internals.

const MIN = 60 * 1000;

const appState = vi.hoisted(() => {
  const listeners: Array<(s: string) => void> = [];
  return {
    currentState: "active",
    addEventListener: (_t: string, fn: (s: string) => void) => { listeners.push(fn); },
    emit(s: string) { appState.currentState = s; for (const fn of [...listeners]) fn(s); },
    listenerCount: () => listeners.length,
    reset() { listeners.length = 0; appState.currentState = "active"; },
  };
});
vi.mock("react-native", () => ({ Platform: { OS: "ios" }, AppState: appState }));
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

function silenceConsole() {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
}

const g = global as any;
const saved = { XMLHttpRequest: g.XMLHttpRequest, fetch: g.fetch };

/**
 * RN's XHR plus the whatwg-fetch wrapper it builds on top — the single chokepoint the
 * native build patches (§4.4). Installed before init so the patch lands on this prototype.
 */
function installRNHttp() {
  function XHR(this: any) { this.status = 200; this._l = {}; }
  XHR.prototype.open = function () {};
  XHR.prototype.send = function (this: any) { (this._l["loadend"] || []).forEach((cb: any) => cb()); };
  XHR.prototype.addEventListener = function (this: any, t: string, cb: any) {
    (this._l[t] = this._l[t] || []).push(cb);
  };
  XHR.prototype.getResponseHeader = () => null;
  g.XMLHttpRequest = XHR;
  g.fetch = async (url: string, init?: any) => {
    const x = new g.XMLHttpRequest();
    x.open(init?.method ?? "GET", url);
    x.send(init?.body);
    return { status: x.status };
  };
}

async function launch(store: Store = memoryStore()) {
  const { createTelemetry } = await import("./createTelemetry.native");
  const sent: TelemetryEvent[] = [];
  const t = createTelemetry({
    apiKey: "edge_trace",
    endpoint: "https://collector/telemetry",
    sender: { send: async (e: TelemetryEvent[]) => { sent.push(...e); } },
    store,
    batchSize: 500,
    flushIntervalMs: 0,
  });
  await settle();   // the trackers install fire-and-forget behind dynamic imports
  // The AppState listener attaches behind instancePromise; wait for it rather than guess a
  // microtask count, or a background emit lands before anything is listening.
  await vi.waitFor(() => expect(appState.listenerCount()).toBeGreaterThan(0));
  return { t, sent };
}

/** Spin the microtask queue: fake timers do not drain the promise chains behind log(). */
async function settle() {
  for (let i = 0; i < 200; i++) await Promise.resolve();
}

async function request(url = "https://api.example.com/v2/accounts/91/balance") {
  await g.fetch(url);
  await settle();
}

const attrsOf = (sent: TelemetryEvent[], name: string) =>
  sent.filter((e) => e.eventName === name).map((e) => e.attributes!);
const one = (sent: TelemetryEvent[], name: string) => attrsOf(sent, name)[0];

beforeEach(() => {
  silenceConsole();
  appState.reset();
  installRNHttp();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-14T10:00:00.000Z"));
});
afterEach(() => {
  g.XMLHttpRequest = saved.XMLHttpRequest;
  g.fetch = saved.fetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("#98 native — app.start and the launch root", () => {
  it("is emitted at launch as a root, with the identity §6.1 requires", async () => {
    const { t, sent } = await launch();
    await t.flush();

    const a = one(sent, "app.start");
    expect(a).toBeDefined();
    expect(a["event.name"]).toBeUndefined();          // allowlisted, not remapped
    expect(a["trace.root_type"]).toBe("launch");
    expect(a["trace.id"]).toMatch(/^[0-9a-f]{32}$/);
    expect(a["rum.action.id"]).toBe(a["span.id"]);
    expect(a["parent.span.id"]).toBeUndefined();
    // Native's launch span starts at `initialize()` — everything before the JS bundle loads
    // is invisible, so this is NOT comparable with web's `performance.timeOrigin` (§6.2).
    // On a fresh launch both are stamped in the same constructor tick.
    expect(a["span.start_time"]).toBe(a["session.start_time"]);
    expect(a["span.duration_ms"]).toBeUndefined();
  });

  it("the initial view is the launch root's child, so a relaunch is never `navigation`", async () => {
    const { t, sent } = await launch();
    const inst = await (t as any).instancePromise;
    await inst.enterView("A", "route");    // names the initial view
    await inst.enterView("B", "route");    // …and this exits it
    await t.flush();

    const start = one(sent, "app.start");
    const initial = one(sent, "view");
    expect(initial["view.name"]).toBe("A");
    expect(initial["trace.id"]).toBe(start["trace.id"]);
    expect(initial["parent.span.id"]).toBe(start["span.id"]);
    expect(initial["trace.root_type"]).toBe("launch");
    // A point span: entry time, and never a width (§6.3).
    expect(typeof initial["span.start_time"]).toBe("string");
    expect(initial["span.duration_ms"]).toBeUndefined();
  });
});

describe("#98 native — the three roots", () => {
  it("a navigation with no live root mints one; a request with none mints its own", async () => {
    const { t, sent } = await launch();
    const inst = await (t as any).instancePromise;
    await inst.enterView("A", "route");

    vi.setSystemTime(Date.now() + 5000);    // the launch root has expired
    await inst.enterView("B", "route");     // A exits; B opens with nothing live
    vi.setSystemTime(Date.now() + 5000);
    await inst.enterView("C", "route");     // …so B's row reaches the wire
    await t.flush();

    const views = attrsOf(sent, "view");
    expect(views[0]["trace.root_type"]).toBe("launch");
    expect(views[1]["trace.root_type"]).toBe("navigation");
    expect(views[1]["rum.action.id"]).toBe(views[1]["span.id"]);
    expect(views[1]["parent.span.id"]).toBeUndefined();
  });

  it("XHR is the chokepoint: a request root, then a child that carries span.duration_ms", async () => {
    const { t, sent } = await launch();
    await t.flush();
    vi.setSystemTime(Date.now() + 5000);

    await request();
    vi.setSystemTime(Date.now() + 500);
    await request("https://api.example.com/v2/cards");
    await t.flush();

    const reqs = attrsOf(sent, "http.request");
    expect(reqs).toHaveLength(2);
    expect(reqs[0]["trace.root_type"]).toBe("request");
    expect(reqs[0]["parent.span.id"]).toBeUndefined();
    expect(reqs[0]["span.duration_ms"]).toBeUndefined();
    expect(reqs[1]["rum.action.id"]).toBe(reqs[0]["span.id"]);
    expect(reqs[1]["parent.span.id"]).toBe(reqs[0]["span.id"]);
    expect(reqs[1]["trace.root_type"]).toBe("request");
    expect(typeof reqs[1]["span.duration_ms"]).toBe("number");
  });
});

describe("#98 native — the three tiers", () => {
  it("Tier 2 annotates without a span; Tier 3 carries no trace key at all", async () => {
    const { t, sent } = await launch();
    await t.log("app.crash", { "crash.message": "boom" });
    await t.log("checkout_started");                 // → custom_event
    const inst = await (t as any).instancePromise;
    await inst.logMetric("frame_render_time", 16);
    await t.log("app_lifecycle", { "app_lifecycle.state": "background" });
    await t.log("network_change", { "network.type": "cellular" });
    await t.identify({ name: "Ada" });
    await t.flush();

    const start = one(sent, "app.start");
    for (const name of ["app.crash", "custom_event"]) {
      const a = one(sent, name);
      expect(a["trace.id"]).toBe(start["trace.id"]);
      expect(a["rum.action.id"]).toBe(start["span.id"]);
      expect(a["trace.root_type"]).toBe("launch");
      expect(a["span.id"]).toBeUndefined();
      expect(a["parent.span.id"]).toBeUndefined();
      expect(a["span.start_time"]).toBeUndefined();
    }

    const tier3 = sent.filter((e) =>
      e.type === "metric"
      || ["app_lifecycle", "network_change", "session.started",
          "user.profile.update"].includes(e.eventName ?? ""));
    expect(tier3.length).toBeGreaterThanOrEqual(5);
    for (const e of tier3) {
      for (const k of ["trace.id", "span.id", "parent.span.id", "rum.action.id",
                       "trace.root_type", "span.start_time", "span.duration_ms"]) {
        expect(e.attributes![k]).toBeUndefined();
      }
    }
  });
});

describe("#98 native — the carrier's boundaries", () => {
  it("backgrounding clears the live root: the first fetch after resume mints its own", async () => {
    const { t, sent } = await launch();
    await t.flush();

    appState.emit("background");
    await settle();
    appState.emit("active");
    await settle();

    await request();                       // still well inside the launch root's 2 s window
    await t.flush();

    const req = one(sent, "http.request");
    expect(req["trace.root_type"]).toBe("request");
    expect(req["rum.action.id"]).toBe(req["span.id"]);
  });

  it("trace.id never spans a session.id (§6.6, invariant 2)", async () => {
    const { t, sent } = await launch();
    await t.log("custom_event");
    vi.setSystemTime(Date.now() + 31 * MIN);
    await t.log("custom_event");           // the idle rotation
    await request();
    await t.flush();

    const bySession = new Map<string, Set<string>>();
    for (const e of sent) {
      const trace = e.attributes!["trace.id"];
      if (!trace) continue;
      const set = bySession.get(trace) ?? new Set<string>();
      set.add(e.attributes!["session.id"]);
      bySession.set(trace, set);
    }
    expect(bySession.size).toBeGreaterThan(1);
    for (const sessions of bySession.values()) expect(sessions.size).toBe(1);
  });

  it("holds across the expired-record cold launch — §4.3's most common relaunch path", async () => {
    // Hydration adopts the stale record, emits the departing `view` and `session.finalized`
    // under the OLD session and starts a fresh one — all before `app.start` ships.
    const now = Date.now();
    const store = memoryStore({
      async: true,
      seed: {
        [SESSION_KEY]: JSON.stringify({
          id: "session_1_aaaaaaaaaaaaaaaa_ios", start: now - 90 * MIN, lastActivity: now - 60 * MIN,
          sequence: 3, eventSequence: 42, eventCount: 42, errorCount: 0,
          sampled: true, sampleRate: 1,
        }),
      },
    });
    const { t, sent } = await launch(store);
    await t.flush();

    expect(sent.map((e) => e.eventName)).toContain("session.finalized");

    const bySession = new Map<string, Set<string>>();
    for (const e of sent) {
      const trace = e.attributes!["trace.id"];
      if (!trace) continue;
      const set = bySession.get(trace) ?? new Set<string>();
      set.add(e.attributes!["session.id"]);
      bySession.set(trace, set);
    }
    for (const sessions of bySession.values()) expect(sessions.size).toBe(1);
    expect(one(sent, "app.start")["session.id"]).not.toBe("session_1_aaaaaaaaaaaaaaaa_ios");
  });

  it("rum.action.id MAY span a view.id — an action outlives the screen it started on", async () => {
    const { t, sent } = await launch();
    const inst = await (t as any).instancePromise;
    await inst.enterView("A", "route");
    await t.flush();

    vi.setSystemTime(Date.now() + 5000);
    await request();                       // mints a request root while the user is on A
    await inst.enterView("B", "route");    // the route change *extends* it
    await request("https://api.example.com/v2/cards");   // B's mount fetch, same action
    await t.flush();

    const reqs = attrsOf(sent, "http.request");
    expect(reqs[1]["rum.action.id"]).toBe(reqs[0]["rum.action.id"]);
    expect(reqs[1]["view.id"]).not.toBe(reqs[0]["view.id"]);
  });
});
