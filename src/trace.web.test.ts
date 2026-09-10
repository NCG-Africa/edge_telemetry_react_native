import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTelemetry } from "./createTelemetry.web";
import type { TelemetryEvent } from "./core/telemetry";
import { memoryStore } from "./core/memoryStore";
import type { SyncStore } from "./core/store";

// #98 — trace and span core observed the only way that matters: the public API in, the
// injected Sender's TelemetryEvent[] out. Names, keys, values and **absence**, since §6.1's
// null discipline is "absent means the SDK had nothing". Nothing reaches into TraceManager.

const MIN = 60 * 1000;

function silenceConsole() {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
}

function launch(store: SyncStore = memoryStore()) {
  const sent: TelemetryEvent[] = [];
  const t = createTelemetry({
    apiKey: "edge_trace",
    endpoint: "https://collector/telemetry",
    sender: { send: async (e: TelemetryEvent[]) => { sent.push(...e); } },
    store,
    batchSize: 500,
    flushIntervalMs: 0,
  });
  return { t, sent };
}

const attrsOf = (sent: TelemetryEvent[], name: string) =>
  sent.filter((e) => e.eventName === name).map((e) => e.attributes!);
const one = (sent: TelemetryEvent[], name: string) => attrsOf(sent, name)[0];

/** A React Navigation container ref, reduced to the two members the SDK uses. */
function navRef() {
  let listener: (() => void) | undefined;
  let route: any;
  return {
    ref: {
      addListener: (_type: string, fn: () => void) => { listener = fn; },
      getCurrentRoute: () => route,
    },
    go(name: string) { route = { name }; listener?.(); },
  };
}

/**
 * The browser surface the web build patches and listens on. `NetworkTrackerWeb` reads and
 * rewrites `window.fetch`, and the lifecycle adapter listens on `document` — both are
 * fire-and-forget behind a dynamic import, hence `settle()` before the first request.
 */
const win: any = {};
const doc: any = {};

/** Drive the patched fetch the host app would call. Returns once the row is enqueued. */
async function request(url = "https://api.example.com/v2/accounts/91/balance") {
  await win.fetch(url);
  await vi.advanceTimersByTimeAsync(0);
}

/** Flip tab visibility for real, through the listener the SDK registered. */
async function visibility(state: "visible" | "hidden") {
  doc.visibilityState = state;
  for (const fn of doc._listeners.visibilitychange ?? []) fn({});
  await settle();
}

/** The trackers install behind dynamic imports; drain the chain rather than guess a timer. */
async function settle() {
  for (let i = 0; i < 200; i++) await Promise.resolve();
}

beforeEach(() => {
  silenceConsole();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-14T10:00:00.000Z"));

  win._listeners = {} as Record<string, ((e: any) => void)[]>;
  win.addEventListener = (type: string, fn: (e: any) => void) => {
    (win._listeners[type] ??= []).push(fn);
  };
  win.fetch = vi.fn(async () => ({ status: 200, headers: { get: () => null } }));

  doc._listeners = {} as Record<string, ((e: any) => void)[]>;
  doc.visibilityState = "visible";
  doc.addEventListener = (type: string, fn: (e: any) => void) => {
    (doc._listeners[type] ??= []).push(fn);
  };

  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("#98 app.start — the launch root", () => {
  it("is emitted at launch, on the allowlist, as a root", async () => {
    const { t, sent } = launch();
    await settle();
    await t.flush();

    const a = one(sent, "app.start");
    expect(a).toBeDefined();                          // not remapped to custom_event
    expect(a["event.name"]).toBeUndefined();
    expect(a["trace.root_type"]).toBe("launch");
    expect(a["trace.id"]).toMatch(/^[0-9a-f]{32}$/);
    expect(a["span.id"]).toMatch(/^[0-9a-f]{16}$/);
    expect(a["rum.action.id"]).toBe(a["span.id"]);    // §6.1: equal on a root
    expect(a["parent.span.id"]).toBeUndefined();      // omitted on roots
    expect(typeof a["span.start_time"]).toBe("string");
    expect(a["span.duration_ms"]).toBeUndefined();    // roots derive it server-side
  });

  it("ships once per process, even when the session resumes", async () => {
    const store = memoryStore();
    const first = launch(store);
    await first.t.flush();

    vi.setSystemTime(Date.now() + 5 * MIN);   // inside the idle window: a resume
    const second = launch(store);
    await second.t.flush();

    expect(second.sent.some((e) => e.eventName === "session.started")).toBe(false);
    expect(attrsOf(second.sent, "app.start")).toHaveLength(1);
  });

  it("a web hard load is `launch`, never `navigation` — the initial view is its child", async () => {
    const { t, sent } = launch();
    await settle();
    const nav = navRef();
    await t.attachNavigation(nav.ref);

    // The first route name only *upgrades* the initial view's name (rank beats order,
    // §4.5.1); the second is a genuine navigation, and that is what emits the initial view.
    nav.go("Dashboard");
    await vi.advanceTimersByTimeAsync(0);
    nav.go("Settings");
    await vi.advanceTimersByTimeAsync(0);
    await t.flush();

    const start = one(sent, "app.start");
    const initial = one(sent, "view");
    expect(initial["trace.root_type"]).toBe("launch");
    expect(initial["trace.id"]).toBe(start["trace.id"]);
    expect(initial["parent.span.id"]).toBe(start["span.id"]);
  });
});

describe("#98 the three roots", () => {
  it("a navigation with a live root becomes a child; with none it mints a navigation root", async () => {
    const { t, sent } = launch();
    await settle();
    const nav = navRef();
    await t.attachNavigation(nav.ref);

    nav.go("A");                               // names the initial view, opened under launch
    await vi.advanceTimersByTimeAsync(0);
    vi.setSystemTime(Date.now() + 5000);       // past 2 s idle — the launch root is gone
    nav.go("B");                               // A exits; B opens with no root live
    await vi.advanceTimersByTimeAsync(0);
    vi.setSystemTime(Date.now() + 5000);
    nav.go("C");                               // …and now B exits, so its row is on the wire
    await vi.advanceTimersByTimeAsync(0);
    await t.flush();

    const views = attrsOf(sent, "view");
    expect(views[0]["view.name"]).toBe("A");
    expect(views[0]["trace.root_type"]).toBe("launch");       // opened under the live root
    expect(views[1]["view.name"]).toBe("B");
    expect(views[1]["trace.root_type"]).toBe("navigation");   // nothing live: its own root
    expect(views[1]["rum.action.id"]).toBe(views[1]["span.id"]);
    expect(views[1]["parent.span.id"]).toBeUndefined();
  });

  it("a request with no live root mints a request root; a later one joins it", async () => {
    const { t, sent } = launch();
    await settle();
    await t.flush();
    vi.setSystemTime(Date.now() + 5000);       // the launch root has expired

    await request();
    vi.setSystemTime(Date.now() + 500);        // inside 2 s idle
    await request("https://api.example.com/v2/cards");
    await t.flush();

    const reqs = attrsOf(sent, "http.request");
    expect(reqs).toHaveLength(2);
    expect(reqs[0]["trace.root_type"]).toBe("request");
    expect(reqs[0]["rum.action.id"]).toBe(reqs[0]["span.id"]);
    expect(reqs[0]["parent.span.id"]).toBeUndefined();
    expect(reqs[0]["span.duration_ms"]).toBeUndefined();      // the root's is derived

    // The second is a child of the first's root — same action, same trace.
    expect(reqs[1]["trace.id"]).toBe(reqs[0]["trace.id"]);
    expect(reqs[1]["rum.action.id"]).toBe(reqs[0]["span.id"]);
    expect(reqs[1]["parent.span.id"]).toBe(reqs[0]["span.id"]);
    expect(reqs[1]["trace.root_type"]).toBe("request");       // denormalized onto the child
    expect(typeof reqs[1]["span.duration_ms"]).toBe("number");
  });

  it("the SDK's own collector POST neither mints a root nor carries trace keys", async () => {
    const { t, sent } = launch();
    await settle();
    await t.flush();
    vi.setSystemTime(Date.now() + 5000);

    await request("https://collector/telemetry");   // the endpoint itself
    await request();

    await t.flush();
    const reqs = attrsOf(sent, "http.request");
    expect(reqs).toHaveLength(1);                    // the collector POST is never a row
    // …and it did not leave a root behind for the real request to join.
    expect(reqs[0]["rum.action.id"]).toBe(reqs[0]["span.id"]);
  });
});

describe("#98 the three tiers (§6.3)", () => {
  it("Tier 2 annotates without occupying a span, and never mints", async () => {
    const { t, sent } = launch();
    await settle();
    await t.log("app.crash", { "crash.message": "boom" });
    await t.log("checkout_started", { cart: 42 });   // → custom_event
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
      expect(a["span.duration_ms"]).toBeUndefined();
    }
  });

  it("Tier 2 with no live root carries no trace keys at all", async () => {
    const { t, sent } = launch();
    await settle();
    vi.setSystemTime(Date.now() + 5000);
    await t.log("app.crash", { "crash.message": "boom" });
    await t.flush();

    const a = one(sent, "app.crash");
    expect(a["trace.id"]).toBeUndefined();
    expect(a["rum.action.id"]).toBeUndefined();
    expect(a["trace.root_type"]).toBeUndefined();
  });

  it("Tier 3 is trace-free — every metric, lifecycle, network change, session and profile row", async () => {
    const { t, sent } = launch();
    await settle();
    const inst = await (t as any).instancePromise;
    await inst.logMetric("frame_render_time", 16);
    await inst.logMetric("memory_usage", 42);
    await t.log("app_lifecycle", { "app_lifecycle.state": "background" });
    await t.log("network_change", { "network.type": "cellular" });
    await t.identify({ name: "Ada" });
    vi.setSystemTime(Date.now() + 31 * MIN);
    await t.log("custom_event");                    // forces the idle rotation
    await t.flush();

    const tier3 = sent.filter((e) =>
      e.type === "metric"
      || ["app_lifecycle", "network_change", "session.started", "session.finalized",
          "user.profile.update"].includes(e.eventName ?? ""));
    expect(tier3.length).toBeGreaterThanOrEqual(6);
    for (const e of tier3) {
      for (const k of ["trace.id", "span.id", "parent.span.id", "rum.action.id",
                       "trace.root_type", "span.start_time", "span.duration_ms"]) {
        expect(e.attributes![k]).toBeUndefined();
      }
    }
  });
});

describe("#98 the `view` point span", () => {
  it("carries span.start_time and never span.duration_ms", async () => {
    const { t, sent } = launch();
    await settle();
    const nav = navRef();
    await t.attachNavigation(nav.ref);

    nav.go("A");                          // names the view opened at init
    await vi.advanceTimersByTimeAsync(0);
    vi.setSystemTime(Date.now() + 3000);
    nav.go("B");                          // …which exits here
    await vi.advanceTimersByTimeAsync(0);
    await t.flush();

    const v = one(sent, "view");
    expect(v["span.start_time"]).toBe("2026-06-14T10:00:00.000Z");   // entry, not exit
    expect(v["view.time_spent"]).toBe(3000);                          // dwell is a separate key
    expect(v["span.duration_ms"]).toBeUndefined();
  });

  it("parents to the root live at view *entry*, not the one live at exit", async () => {
    const { t, sent } = launch();
    await settle();
    const nav = navRef();
    await t.attachNavigation(nav.ref);

    nav.go("A");                          // names the view opened at init, under launch
    await vi.advanceTimersByTimeAsync(0);
    vi.setSystemTime(Date.now() + 5000);  // the launch root expires while the user sits on A
    await request();                      // a request mints its own root here
    nav.go("B");                          // …and only now does A exit
    await vi.advanceTimersByTimeAsync(0);
    await t.flush();

    const start = one(sent, "app.start");
    const viewA = attrsOf(sent, "view")[0];
    expect(viewA["view.name"]).toBe("A");
    expect(viewA["parent.span.id"]).toBe(start["span.id"]);   // the root that opened it
    expect(viewA["trace.root_type"]).toBe("launch");
  });
});

describe("#98 the carrier's boundaries", () => {
  it("backgrounding clears the live root, so the first fetch after resume mints its own", async () => {
    const { t, sent } = launch();
    await settle();
    await t.flush();

    await visibility("hidden");
    await visibility("visible");

    await request();                                          // well inside 2 s of the launch root
    await t.flush();

    const req = one(sent, "http.request");
    expect(req["trace.root_type"]).toBe("request");            // not `launch`
    expect(req["rum.action.id"]).toBe(req["span.id"]);
  });

  it("expiry is 2 s idle / 10 s cap, and neither is an option on TelemetryOpts", async () => {
    const { t, sent } = launch();
    await settle();
    await t.flush();

    // Exactly 2 s idle still joins…
    vi.setSystemTime(Date.now() + 2000);
    await request();
    // …2001 ms later does not.
    vi.setSystemTime(Date.now() + 2001);
    await request("https://api.example.com/v2/cards");
    // Continuous 1.5 s activity is held by the 10 s cap, not the idle window.
    const ids = new Set<string>();
    for (let i = 0; i < 10; i++) {
      vi.setSystemTime(Date.now() + 1500);
      await request(`https://api.example.com/v2/p${i}`);
    }
    await t.flush();

    const reqs = attrsOf(sent, "http.request");
    expect(reqs[0]["trace.root_type"]).toBe("launch");        // 2 s exactly: still a child
    expect(reqs[1]["trace.root_type"]).toBe("request");       // 2001 ms: its own root
    for (const r of reqs.slice(2)) ids.add(r["trace.id"] as string);
    expect(ids.size).toBeGreaterThan(1);                      // the cap ended one mid-stream

    // Neither number is `TelemetryOpts` surface (§6.7): there is no knob to pass, which is
    // why this test can only drive them through the clock.
  });
});

describe("#98 §6.6's invariants, asserted directly", () => {
  it("trace.id never spans a session.id", async () => {
    const { t, sent } = launch();
    await settle();
    await t.log("custom_event");
    vi.setSystemTime(Date.now() + 31 * MIN);
    await t.log("custom_event");           // the idle rotation
    await request();
    await t.flush();

    const bySession = new Map<string, Set<string>>();
    for (const e of sent) {
      const trace = e.attributes!["trace.id"];
      if (!trace) continue;
      const session = e.attributes!["session.id"];
      (bySession.get(trace) ?? bySession.set(trace, new Set()).get(trace)!).add(session);
    }
    expect(bySession.size).toBeGreaterThan(1);
    for (const sessions of bySession.values()) expect(sessions.size).toBe(1);
  });

  it("rum.action.id MAY span a view.id — an action outlives the screen it started on", async () => {
    const { t, sent } = launch();
    await settle();
    const nav = navRef();
    await t.attachNavigation(nav.ref);
    nav.go("A");
    await vi.advanceTimersByTimeAsync(0);
    await t.flush();

    vi.setSystemTime(Date.now() + 5000);
    await request();                       // mints a request root while the user is on A
    nav.go("B");                           // the route change *extends* it
    await vi.advanceTimersByTimeAsync(0);
    await request("https://api.example.com/v2/cards");   // B's mount fetch, same action
    await t.flush();

    const reqs = attrsOf(sent, "http.request");
    const action = reqs[0]["rum.action.id"];
    expect(reqs[1]["rum.action.id"]).toBe(action);
    // One rum.action.id, two view.ids, every row correct.
    expect(reqs[1]["view.id"]).not.toBe(reqs[0]["view.id"]);
  });
});
