import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TelemetryEvent } from "./core/telemetry";
import { memoryStore } from "./core/memoryStore";
import type { Store } from "./core/store";

// #103 / §4.6 — native's explicit-only `trackTap(name)`, asserted where the contract lives:
// the TelemetryEvent[] that reaches the injected Sender. Keys, values and **absence** —
// `ui.rage` is omitted when false and `ui.dead` cannot exist on a build with no DOM.

const appState = vi.hoisted(() => {
  const listeners: Array<(s: string) => void> = [];
  return {
    currentState: "active",
    addEventListener: (_t: string, fn: (s: string) => void) => { listeners.push(fn); },
    listenerCount: () => listeners.length,
    reset() { listeners.length = 0; appState.currentState = "active"; },
  };
});
vi.mock("react-native", () => ({ Dimensions: { get: () => ({ width: 390, height: 844 }) }, PixelRatio: { get: () => 3 }, Platform: { OS: "ios" }, AppState: appState }));
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

/** RN's XHR — the single chokepoint the native build patches (§4.4). */
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
    apiKey: "edge_tap",
    endpoint: "https://collector/telemetry",
    sender: { send: async (e: TelemetryEvent[]) => { sent.push(...e); } },
    store,
    batchSize: 500,
    flushIntervalMs: 0,
  });
  await settle();
  await vi.waitFor(() => expect(appState.listenerCount()).toBeGreaterThan(0));
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

/** Spin the microtask queue: fake timers do not drain the promise chains behind log(). */
async function settle() {
  for (let i = 0; i < 200; i++) await Promise.resolve();
}

const rowsOf = (sent: TelemetryEvent[], name: string) => sent.filter((e) => e.eventName === name);
const attrsOf = (sent: TelemetryEvent[], name: string) => rowsOf(sent, name).map((e) => e.attributes!);

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

describe("#103 trackTap — native's only interaction producer (§4.6)", () => {
  it("emits ui.interaction with the native key set and no web-only keys", async () => {
    const { t, sent } = await launch();
    await (t as any).trackTap("Checkout Now");
    await t.flush();

    const rows = attrsOf(sent, "ui.interaction");
    expect(rows).toHaveLength(1);
    expect(rows[0]["ui.type"]).toBe("tap");
    // Rung 1's equivalent: explicit author intent, so it passes through unnormalized and
    // uncapped — a consumer must be able to predict the value they just set.
    expect(rows[0]["ui.target"]).toBe("Checkout Now");
    expect(rows[0]["ui.name_source"]).toBe("edge_action");
    expect(typeof rows[0]["ui.tag"]).toBe("string");
    expect(rows[0]["ui.x"]).toBe(0);
    expect(rows[0]["ui.y"]).toBe(0);
    // `ui.dead` cannot exist on a build with no DOM — absent, never false (§4.6).
    expect(rows[0]).not.toHaveProperty("ui.dead");
    // Absent means false, deliberately asymmetric with `ui.dead`.
    expect(rows[0]).not.toHaveProperty("ui.rage");
  });

  it("has a two-value name_source and never ships `surface`", async () => {
    const { t, sent } = await launch();
    await (t as any).trackTap("checkout");
    await (t as any).trackTap("");
    await (t as any).trackTap("   ");
    await t.flush();

    const rows = attrsOf(sent, "ui.interaction");
    expect(rows.map((r) => r["ui.name_source"])).toEqual(["edge_action", "none", "none"]);
    // `surface` only means something where role-less elements exist, and native has none.
    expect(rows.map((r) => r["ui.target"])).toEqual(["checkout", "unnamed", "unnamed"]);
    for (const r of rows) expect(r["ui.target"]).not.toBe("surface");
  });

  it("counts into view.action_count like any other interaction row", async () => {
    const { t, sent } = await launch();
    const nav = navRef();
    await t.attachNavigation(nav.ref);
    nav.go("Home");                            // rung upgrade — still the launch view
    await vi.advanceTimersByTimeAsync(0);
    await (t as any).trackTap("a");
    await (t as any).trackTap("b");
    nav.go("Next");                            // same rung, new name — the view exits
    await vi.advanceTimersByTimeAsync(0);
    await t.flush();

    expect(attrsOf(sent, "view")[0]["view.action_count"]).toBe(2);
  });
});

describe("#103 the mint/emit split (§4.6)", () => {
  it("a tap that navigates keeps its frozen view.id and mint timestamp, and takes the id's current name", async () => {
    const { t, sent } = await launch();
    const inst = await (t as any).instancePromise;
    const nav = navRef();
    await t.attachNavigation(nav.ref);
    nav.go("Home");
    await vi.advanceTimersByTimeAsync(0);

    const mintedAt = Date.now();
    const tap = (t as any).trackTap("checkout");
    // Same tick, before any microtask the emit could be riding: the host's own press
    // handler navigates. `explicit` outranks `route`, so this is a rung **upgrade** — it
    // re-stamps `view.name` in place and leaves `view.id` alone (§4.5.1).
    void inst.enterView("Checkout", "explicit");
    vi.setSystemTime(mintedAt + 5000);
    await tap;
    await t.flush();

    const [row] = rowsOf(sent, "ui.interaction");
    // ⚠ #108/§3.1 — the name is resolved at log time by lookup on the **frozen** id, so an
    // upgrade inside the emit window shows through. It has to: the id never moved, and a row
    // carrying "Home" against the id now named "Checkout" would disagree with itself. The
    // freeze is on the id and the timestamp, which is what the mint/emit split is for.
    expect(row.attributes!["view.name"]).toBe("Checkout");
    expect(row.timestamp).toBe(new Date(mintedAt).toISOString());
  });

  it("keeps the departing view.id when the tap opens a new screen", async () => {
    const { t, sent } = await launch();
    const nav = navRef();
    await t.attachNavigation(nav.ref);
    nav.go("Home");
    await vi.advanceTimersByTimeAsync(0);
    await t.log("custom_event");            // stamps the Home view's id

    const tap = (t as any).trackTap("checkout");
    nav.go("Cart");
    await vi.advanceTimersByTimeAsync(0);
    await tap;
    await t.log("custom_event");            // stamps the Cart view's id
    await t.flush();

    const [home, cart] = attrsOf(sent, "custom_event");
    expect(cart["view.id"]).not.toBe(home["view.id"]);
    expect(attrsOf(sent, "ui.interaction")[0]["view.id"]).toBe(home["view.id"]);
  });
});

describe("#103 ui.rage on native (§4.6)", () => {
  it("flags once per burst at three named taps inside the window", async () => {
    const { t, sent } = await launch();
    for (let i = 0; i < 4; i++) {
      await (t as any).trackTap("checkout");
      vi.setSystemTime(Date.now() + 100);
    }
    await t.flush();

    const rows = attrsOf(sent, "ui.interaction");
    expect(rows.map((r) => r["ui.rage"])).toEqual([undefined, undefined, true, undefined]);
  });

  it("does not fire across the window, nor across two different names", async () => {
    const { t, sent } = await launch();
    for (let i = 0; i < 3; i++) {
      await (t as any).trackTap("checkout");
      vi.setSystemTime(Date.now() + 600);   // 1200 ms apart at the crossing tap
    }
    await (t as any).trackTap("a");
    await (t as any).trackTap("b");
    await (t as any).trackTap("a");
    await t.flush();

    for (const r of attrsOf(sent, "ui.interaction")) expect(r).not.toHaveProperty("ui.rage");
  });

  it("is gated to named taps — an unnamed burst invents no frustration", async () => {
    const { t, sent } = await launch();
    for (let i = 0; i < 4; i++) await (t as any).trackTap("");
    await t.flush();

    for (const r of attrsOf(sent, "ui.interaction")) expect(r).not.toHaveProperty("ui.rage");
  });
});

describe("#103 every tap mints an interaction root (§6.2)", () => {
  it("the row is root-shaped and its children carry trace.root_type = interaction", async () => {
    const { t, sent } = await launch();
    await (t as any).trackTap("checkout");
    await g.fetch("https://api.example.com/cart");
    await settle();
    await t.flush();

    const [tap] = attrsOf(sent, "ui.interaction");
    expect(tap["rum.action.id"]).toBe(tap["span.id"]);   // §6.1: root identity
    expect(tap["trace.root_type"]).toBe("interaction");
    expect(tap).not.toHaveProperty("parent.span.id");

    const [req] = attrsOf(sent, "http.request");
    expect(req["trace.id"]).toBe(tap["trace.id"]);
    expect(req["parent.span.id"]).toBe(tap["span.id"]);
    expect(req["rum.action.id"]).toBe(tap["rum.action.id"]);
    expect(req["trace.root_type"]).toBe("interaction");
  });

  it("mints unconditionally — a second tap replaces the live root rather than joining it", async () => {
    const { t, sent } = await launch();
    await (t as any).trackTap("first");
    await (t as any).trackTap("second");
    await t.flush();

    const [first, second] = attrsOf(sent, "ui.interaction");
    expect(second["span.id"]).not.toBe(first["span.id"]);
    expect(second["trace.id"]).not.toBe(first["trace.id"]);
    expect(second).not.toHaveProperty("parent.span.id");
  });
});
