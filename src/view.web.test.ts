import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTelemetry } from "./createTelemetry.web";
import type { TelemetryEvent } from "./core/telemetry";
import { memoryStore } from "./core/memoryStore";
import type { SyncStore } from "./core/store";

// #96 — the View entity observed the only way that matters: the public API in, the injected
// Sender's TelemetryEvent[] out. Time is fake timers, persistence is the in-memory Store fake,
// and React Navigation is a hand-rolled ref double. Nothing reaches into ViewManager.

const MIN = 60 * 1000;

function silenceConsole() {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
}

function launch(store: SyncStore = memoryStore()) {
  const sent: TelemetryEvent[] = [];
  const t = createTelemetry({
    apiKey: "edge_view",
    endpoint: "https://x/telemetry",
    sender: { send: async (e: TelemetryEvent[]) => { sent.push(...e); } },
    store,
    batchSize: 200,
    flushIntervalMs: 0,
  });
  return { t, sent };
}

/** A React Navigation container ref, reduced to the two members the SDK uses. */
function navRef() {
  let listener: (() => void) | undefined;
  let route: any;
  return {
    ref: {
      addListener: (_type: string, fn: () => void) => { listener = fn; },
      getCurrentRoute: () => route,
    },
    go(name: string, state?: any) { route = state ?? { name }; listener?.(); },
  };
}

const attrsOf = (sent: TelemetryEvent[], name: string) =>
  sent.filter((e) => e.eventName === name).map((e) => e.attributes!);

beforeEach(() => {
  silenceConsole();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-14T10:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("#96 view.id / view.name on the Context block (web)", () => {
  it("rides every event and every metric, and is never null", async () => {
    const { t, sent } = launch();
    await t.log("custom_event");
    const inst = await (t as any).instancePromise;
    await inst.logMetric("memory_usage", 42);
    await t.flush();

    expect(sent.length).toBeGreaterThan(1);
    for (const e of sent) {
      expect(e.attributes!["view.id"]).toMatch(/^view_\d+_[0-9a-f]{16}$/);
      expect(typeof e.attributes!["view.name"]).toBe("string");
      expect(e.attributes!["view.name"]).not.toBe("");
    }
    // the metric is on the metric path and still carries both
    const metric = sent.find((e) => e.metricName === "memory_usage")!;
    expect(metric.attributes!["view.id"]).toBeDefined();
  });

  it("attachNavigation works on the web build and names the view from route.name", async () => {
    const { t, sent } = launch();
    const nav = navRef();
    await t.attachNavigation(nav.ref);

    nav.go("Dashboard");
    await vi.advanceTimersByTimeAsync(0);
    await t.log("custom_event");
    await t.flush();

    expect(attrsOf(sent, "custom_event")[0]["view.name"]).toBe("Dashboard");
    // §4.0/§4.11: web emits neither deprecated feed, and a shared attachNavigation must not
    // be the thing that starts it.
    expect(sent.map((e) => e.eventName)).not.toContain("screen.duration");
  });

  it("resolves the deepest route of a nested navigator", async () => {
    const { t, sent } = launch();
    const nav = navRef();
    await t.attachNavigation(nav.ref);

    nav.go("Tabs", { name: "Tabs", state: { index: 1, routes: [{ name: "Home" }, { name: "Settings" }] } });
    await vi.advanceTimersByTimeAsync(0);
    await t.log("custom_event");
    await t.flush();

    expect(attrsOf(sent, "custom_event")[0]["view.name"]).toBe("Settings");
  });

  it("a route change emits the departing view with dwell and the three counters", async () => {
    const { t, sent } = launch();
    const nav = navRef();
    await t.attachNavigation(nav.ref);

    nav.go("Home");
    await vi.advanceTimersByTimeAsync(0);
    await t.flush();
    const firstId = attrsOf(sent, "session.started")[0]["view.id"];

    await t.log("app.crash", { "error.message": "boom" });
    await t.log("user.interaction", { "interaction.type": "tap" });
    await t.log("http.request", { "http.status_code": 500 });
    vi.setSystemTime(Date.now() + 5000);

    nav.go("Cart");
    await vi.advanceTimersByTimeAsync(0);
    await t.flush();

    const view = attrsOf(sent, "view")[0];
    expect(view["view.id"]).toBe(firstId);          // the row belongs to the view it describes
    expect(view["view.name"]).toBe("Home");
    expect(view["view.name_source"]).toBe("route");
    expect(view["view.load_type"]).toBe("initial_load");
    expect(view["view.referrer"]).toBe("");         // first view of the process, "" not null
    expect(view["view.time_spent"]).toBe(5000);
    expect(view["view.error_count"]).toBe(1);       // app.crash only — a 500 is not an error here
    expect(view["view.action_count"]).toBe(1);
    expect(view["view.request_count"]).toBe(1);

    // and the successor is a different view under the same session
    const after = attrsOf(sent, "view")[0];
    await t.log("custom_event");
    await t.flush();
    const next = attrsOf(sent, "custom_event")[0];
    expect(next["view.id"]).not.toBe(after["view.id"]);
    expect(next["view.name"]).toBe("Cart");
  });
});

describe("#96 the name ladder on the wire (web)", () => {
  it("a route name arriving after a URL-derived one re-stamps the name, same view.id", async () => {
    const { t, sent } = launch();
    const inst = await (t as any).instancePromise;

    await inst.enterView("/dashboard/{id}", "url");
    await t.log("custom_event");
    await inst.enterView("Dashboard", "route");
    await t.log("custom_event");
    await t.flush();

    const [early, late] = attrsOf(sent, "custom_event");
    expect(early["view.name"]).toBe("/dashboard/{id}");
    expect(late["view.name"]).toBe("Dashboard");
    expect(late["view.id"]).toBe(early["view.id"]);   // upgraded in place, never split
    expect(sent.map((e) => e.eventName)).not.toContain("view");
  });

  it("a lower rung arriving later is ignored outright", async () => {
    const { t, sent } = launch();
    const inst = await (t as any).instancePromise;

    await inst.enterView("Checkout", "route");
    await inst.enterView("/checkout/7781", "url");
    await t.log("custom_event");
    await t.flush();

    expect(attrsOf(sent, "custom_event")[0]["view.name"]).toBe("Checkout");
  });

  it("screenStart's name overrides a derived one and is never normalized", async () => {
    const { t, sent } = launch();
    const inst = await (t as any).instancePromise;

    await inst.enterView("/step/2", "url");
    await inst.enterView("Step 2 of 3", "explicit");
    await t.log("custom_event");
    await t.flush();

    const a = attrsOf(sent, "custom_event")[0];
    expect(a["view.name"]).toBe("Step 2 of 3");   // not "Step {id} of {id}"
  });
});

describe("#96 view lifetime boundaries (web)", () => {
  it("view.id never spans a session.id — a rotation emits the view under the old session", async () => {
    const { t, sent } = launch();
    await t.log("custom_event");

    vi.setSystemTime(Date.now() + 31 * MIN);   // past the 30-minute idle boundary
    await t.log("custom_event");
    await t.flush();

    const rows = sent.filter((e) => e.attributes?.["view.id"]);
    const bySession = new Map<string, Set<string>>();
    for (const r of rows) {
      const s = r.attributes!["session.id"], v = r.attributes!["view.id"];
      (bySession.get(v) ?? bySession.set(v, new Set()).get(v)!).add(s);
    }
    for (const [viewId, sessions] of bySession) {
      expect(sessions.size, `view ${viewId} spans ${[...sessions].join(", ")}`).toBe(1);
    }

    const view = attrsOf(sent, "view")[0];
    const finalized = attrsOf(sent, "session.finalized")[0];
    const started = attrsOf(sent, "session.started");
    expect(view["session.id"]).toBe(finalized["session.id"]);   // emitted under the old session
    expect(started).toHaveLength(2);
    expect(started[1]["view.load_type"]).toBeUndefined();       // only the `view` event carries it
    expect(started[1]["view.id"]).not.toBe(view["view.id"]);
  });

  it("the successor of a session rotation reports load_type session_rotation", async () => {
    const { t, sent } = launch();
    const inst = await (t as any).instancePromise;
    await inst.enterView("Home", "route");
    await t.log("custom_event");

    vi.setSystemTime(Date.now() + 31 * MIN);
    await t.log("custom_event");
    // The successor inherits `Home` from the view it replaced, so a same-rung move off it
    // is a real boundary and its `view` row becomes observable.
    await inst.enterView("Next", "route");
    await t.flush();

    const loadTypes = attrsOf(sent, "view").map((a) => a["view.load_type"]);
    expect(loadTypes).toEqual(["initial_load", "session_rotation"]);
  });

  it("`view` is on the allowlist — it is not rewritten to custom_event", async () => {
    const { t, sent } = launch();
    const inst = await (t as any).instancePromise;
    await inst.enterView("A", "route");
    await inst.enterView("B", "route");
    await t.flush();

    const view = sent.find((e) => e.eventName === "view")!;
    expect(view).toBeDefined();
    expect(view.attributes!["event.name"]).toBeUndefined();
  });
});
