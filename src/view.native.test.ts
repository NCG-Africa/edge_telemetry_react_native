import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TelemetryEvent } from "./core/telemetry";
import { memoryStore } from "./core/memoryStore";
import type { Store } from "./core/store";

// #96 native mirror of view.web.test.ts. Platform APIs are module-stubbed; the assertions are
// on the TelemetryEvent[] that reaches the injected Sender, never on manager internals.

const appState = vi.hoisted(() => {
  const listeners: Array<(s: string) => void> = [];
  return {
    currentState: "active",
    addEventListener: (_t: string, fn: (s: string) => void) => { listeners.push(fn); },
    emit(s: string) { appState.currentState = s; for (const fn of [...listeners]) fn(s); },
    listenerCount: () => listeners.length,
    // Cleared per test, unlike session.lifecycle.native.test.ts: these tests wait on
    // listenerCount to know THIS test's emitter has attached, and a leftover listener
    // satisfies that wait early — the emitter then seeds off whatever currentState the
    // previous test left behind and reads the next edge backwards.
    reset() { listeners.length = 0; appState.currentState = "active"; },
  };
});
vi.mock("react-native", () => ({ Platform: { OS: "android" }, AppState: appState }));
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

async function launch(store: Store = memoryStore()) {
  const { createTelemetry } = await import("./createTelemetry.native");
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
    go(name: string) { route = { name }; listener?.(); },
  };
}

/**
 * The lifecycle boundary is a promise chain behind an already-async log(), and fake timers
 * do not drain microtasks. Spin the queue instead of guessing a timer value.
 */
async function settle() {
  for (let i = 0; i < 200; i++) await Promise.resolve();
}

const attrsOf = (sent: TelemetryEvent[], name: string) =>
  sent.filter((e) => e.eventName === name).map((e) => e.attributes!);

beforeEach(() => {
  silenceConsole();
  appState.reset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-14T10:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("#96 view.id / view.name on the Context block (native)", () => {
  it("rides every event and every metric, and is never null", async () => {
    const { t, sent } = await launch();
    await t.log("custom_event");
    const inst = await (t as any).instancePromise;
    await inst.logMetric("frame_render_time", 16);
    await t.flush();

    expect(sent.length).toBeGreaterThan(1);
    for (const e of sent) {
      expect(e.attributes!["view.id"]).toMatch(/^view_\d+_[0-9a-f]{16}$/);
      expect(typeof e.attributes!["view.name"]).toBe("string");
      expect(e.attributes!["view.name"]).not.toBe("");
    }
  });

  it("omits view.host — the origin key is web-only (§4.5)", async () => {
    const { t, sent } = await launch();
    const inst = await (t as any).instancePromise;
    await inst.enterView("A", "route");
    await inst.enterView("B", "route");
    await t.flush();

    expect(attrsOf(sent, "view")[0]).not.toHaveProperty("view.host");
  });
});

describe("#96 the two native screen paths, unified (§4.11)", () => {
  it("screen.duration now fires for a React Navigation consumer, and navigation still fires", async () => {
    const { t, sent } = await launch();
    const nav = navRef();
    await t.attachNavigation(nav.ref);

    nav.go("Home");
    await vi.advanceTimersByTimeAsync(0);
    vi.setSystemTime(Date.now() + 4000);
    nav.go("Cart");
    await vi.advanceTimersByTimeAsync(0);
    await t.flush();

    // v3's defect: attachNavigation registered a listener that never touched `screens`, so a
    // React Navigation app emitted `navigation` on every route change and never one
    // `screen.duration`. Unifying both paths onto the ViewManager is what fixes it.
    const durations = attrsOf(sent, "screen.duration");
    expect(durations).toHaveLength(1);
    expect(durations[0]["screen.name"]).toBe("Home");
    expect(durations[0]["screen.duration_ms"]).toBe(4000);
    expect(durations[0]["screen.exit_method"]).toBe("navigation");

    // and `navigation` is unchanged — same keys, same values, one per route change
    const navs = attrsOf(sent, "navigation");
    expect(navs).toHaveLength(2);
    expect(navs[0]["navigation.from_screen"]).toBe("init");
    expect(navs[0]["navigation.to_screen"]).toBe("Home");
    expect(navs[1]["navigation.from_screen"]).toBe("Home");
    expect(navs[1]["navigation.to_screen"]).toBe("Cart");
    expect(navs[1]["navigation.method"]).toBe("push");
    expect(navs[1]["navigation.route_type"]).toBe("screen");
  });

  it("the deprecated rows land in the view they describe, not the one being entered", async () => {
    const { t, sent } = await launch();
    const nav = navRef();
    await t.attachNavigation(nav.ref);

    nav.go("Home");
    await vi.advanceTimersByTimeAsync(0);
    nav.go("Cart");
    await vi.advanceTimersByTimeAsync(0);
    await t.flush();

    const view = attrsOf(sent, "view")[0];
    expect(attrsOf(sent, "screen.duration")[0]["view.id"]).toBe(view["view.id"]);
    expect(attrsOf(sent, "navigation")[1]["view.id"]).toBe(view["view.id"]);
  });

  it("screenStart names the view explicitly and screenEnd still emits screen.duration", async () => {
    const { t, sent } = await launch();
    await (t as any).screenStart("Checkout");
    vi.setSystemTime(Date.now() + 2500);
    await t.log("custom_event");
    await (t as any).screenEnd("Checkout");
    await t.flush();

    expect(attrsOf(sent, "custom_event")[0]["view.name"]).toBe("Checkout");
    const d = attrsOf(sent, "screen.duration")[0];
    expect(d["screen.name"]).toBe("Checkout");
    expect(d["screen.duration_ms"]).toBe(2500);
  });

  it("a route name and an explicit name agree on the same view.name across builds", async () => {
    const { t, sent } = await launch();
    const nav = navRef();
    await t.attachNavigation(nav.ref);
    nav.go("Dashboard");
    await vi.advanceTimersByTimeAsync(0);
    await t.log("custom_event");
    await t.flush();

    // the same string the web build produces from the same ref — one GROUP BY spans both
    expect(attrsOf(sent, "custom_event")[0]["view.name"]).toBe("Dashboard");
  });
});

describe("#96 view lifetime boundaries (native)", () => {
  it("view.id never spans a session.id", async () => {
    const { t, sent } = await launch();
    await t.log("custom_event");
    vi.setSystemTime(Date.now() + 31 * 60 * 1000);
    await t.log("custom_event");
    await t.flush();

    const seen = new Map<string, string>();
    for (const e of sent) {
      const v = e.attributes!["view.id"], s = e.attributes!["session.id"];
      const prior = seen.get(v);
      if (prior) expect(prior, `view ${v} spans two sessions`).toBe(s);
      else seen.set(v, s);
    }
    expect(seen.size).toBeGreaterThan(1);   // the rotation really did mint a successor
  });
});

describe("#96 the background boundary and the background flush (native)", () => {
  it("the `view` row is in the batch the background flush sends, not enqueued after it", async () => {
    const { t, sent } = await launch();
    const inst = await (t as any).instancePromise;
    // the constructor attaches the AppState listener behind instancePromise
    await vi.waitFor(() => expect(appState.listenerCount()).toBeGreaterThan(0));
    await inst.enterView("Home", "route");
    await t.log("custom_event");

    // Backgrounding: the boundary emits a `view` row and the flush that follows exists to
    // rescue exactly that row from the OS kill that usually comes next. If the flush fires
    // on the next line instead of after the boundary, the row misses the batch it needed.
    appState.emit("background");
    await settle();

    const view = sent.find((e) => e.eventName === "view");
    expect(view, "the background `view` row never reached the sender").toBeDefined();
    expect(view!.attributes!["view.name"]).toBe("Home");
    expect(view!.attributes!["view.load_type"]).toBe("initial_load");

    // and the app_lifecycle row it follows is in the same batch, under the same view
    const lifecycle = sent.find((e) => e.eventName === "app_lifecycle")!;
    expect(lifecycle.attributes!["app_lifecycle.state"]).toBe("background");
    expect(lifecycle.attributes!["view.id"]).toBe(view!.attributes!["view.id"]);
  });

  it("the successor minted on background is a `resume` view under the same session", async () => {
    const { t, sent } = await launch();
    const inst = await (t as any).instancePromise;
    await vi.waitFor(() => expect(appState.listenerCount()).toBeGreaterThan(0));
    await inst.enterView("Home", "route");

    // the boundary is chained behind the app_lifecycle log; let it land before the next edge
    appState.emit("background");
    await settle();
    appState.emit("active");
    await settle();

    await inst.enterView("Cart", "route");   // ends the resumed view so it is observable
    await t.flush();

    const views = sent.filter((e) => e.eventName === "view").map((e) => e.attributes!);
    expect(views.map((a) => a["view.load_type"])).toEqual(["initial_load", "resume"]);
    expect(views[1]["view.referrer"]).toBe("Home");
    expect(views[1]["session.id"]).toBe(views[0]["session.id"]);
    expect(views[1]["view.id"]).not.toBe(views[0]["view.id"]);
  });
});
