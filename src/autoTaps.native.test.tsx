import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import TestRenderer, { act } from "react-test-renderer";
import type { TelemetryEvent } from "./core/telemetry";
import { memoryStore } from "./core/memoryStore";

// #174 — autoTrackTaps through Seam 3 (react-test-renderer), assertions at the Sender. Native
// only: the option does not exist on web. Elements are built with the CJS `React.createElement`
// — the exports object the hook patches, which is what Babel-compiled RN code reads; this
// file's own JSX would go through an ESM binding snapshot the hook cannot reach.

vi.mock("react-native", () => ({ Dimensions: { get: () => ({ width: 390, height: 844 }) }, PixelRatio: { get: () => 3 }, Platform: { OS: "android" }, AppState: { currentState: "active", addEventListener: () => {} } }));
vi.mock("react-native-get-random-values", () => ({}));
vi.mock("react-native-device-info", () => ({ default: new Proxy({}, { get: () => async () => "x" }) }));
vi.mock("@react-native-community/netinfo", () => ({
  default: { fetch: async () => ({ type: "wifi", isConnected: true }), addEventListener: () => {} },
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

const React = createRequire(import.meta.url)("react");
const h = (...a: any[]) => React.createElement(...a);
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0)); };

/** Stands in for RN's Pressable: renders nothing, exposes its (wrapped) props. */
function Pressable(_: any) { return null; }
function AppButton(props: any) { return h(Pressable, { onPress: props.onPress, testID: "inner_pay" }); }

describe("#174 autoTrackTaps (native)", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  async function launch(autoTrackTaps = true) {
    const { createTelemetry } = await import("./createTelemetry.native");
    const sent: TelemetryEvent[] = [];
    const t = createTelemetry({
      apiKey: "edge_taps", endpoint: "https://x/telemetry",
      sender: { send: async (e: TelemetryEvent[]) => { sent.push(...e); } },
      store: memoryStore(), batchSize: 500, flushIntervalMs: 0, autoTrackTaps,
    });
    const inst = await (t as any).instancePromise;
    await settle();
    return { t, inst, sent };
  }
  function render(el: any) {
    let r!: TestRenderer.ReactTestRenderer;
    act(() => { r = TestRenderer.create(el); });
    return r;
  }
  const press = (r: TestRenderer.ReactTestRenderer, prop = "onPress", event: any = {}) =>
    act(() => { r.root.findByType(Pressable).props[prop](event); });
  const taps = (sent: TelemetryEvent[]) => sent.filter((e) => e.eventName === "ui.interaction").map((e) => e.attributes!);

  it("names from testID only — normalized, never text — else unnamed; long press is its own type", async () => {
    const { t, sent } = await launch();
    const a = render(h(Pressable, { onPress: () => {}, testID: "Checkout Button!", accessibilityLabel: "Pay John Kamau" }));
    press(a);
    const b = render(h(Pressable, { onPress: () => {}, onLongPress: () => {} }));
    press(b);
    press(b, "onLongPress");
    await settle();
    await t.flush();

    expect(taps(sent).map((r) => [r["ui.type"], r["ui.target"], r["ui.name_source"], r["ui.tag"]])).toEqual([
      ["tap", "checkout_button", "test_id", "native"],
      ["tap", "unnamed", "none", "native"],
      ["long_press", "unnamed", "none", "native"],
    ]);
    expect(JSON.stringify(sent)).not.toMatch(/John Kamau/);
    for (const r of taps(sent)) expect(r["span.id"]).toBe(r["rum.action.id"]);   // each mints a root
  });

  it("nested pressables are one row with the innermost props; an explicit trackTap inside wins", async () => {
    const { t, sent } = await launch();
    const nested = render(h(AppButton, { onPress: () => {}, testID: "outer" }));
    press(nested);
    const explicit = render(h(Pressable, { onPress: () => { void t.trackTap("Pay now"); }, testID: "pay" }));
    press(explicit);
    await settle();
    await t.flush();
    expect(taps(sent).map((r) => [r["ui.target"], r["ui.name_source"]])).toEqual([
      ["inner_pay", "test_id"],
      ["Pay now", "edge_action"],
    ]);
  });

  it("snapshots before the handler: a navigating tap lands on the screen it was on, and its request is the tap's child", async () => {
    const { t, inst, sent } = await launch();
    await inst.enterView("Home", "route");
    let child: any;
    const r = render(h(Pressable, {
      testID: "open_details",
      onPress: () => {
        child = inst.trace.requestTrace(Date.now(), { url: "https://api/x", sampled: true }).finish(Date.now());
        void inst.enterView("Details", "route");
      },
    }));
    press(r);
    await settle();
    await t.flush();
    const [row] = taps(sent);
    expect(row["view.name"]).toBe("Home");
    expect(child["parent.span.id"]).toBe(row["span.id"]);
  });

  it("the handler keeps a stable identity across renders, and rage keys on the testID", async () => {
    const { t, sent } = await launch();
    const onPress = () => {};
    const r = render(h(Pressable, { onPress, testID: "buy" }));
    const first = r.root.findByType(Pressable).props.onPress;
    act(() => r.update(h(Pressable, { onPress, testID: "buy" })));
    expect(r.root.findByType(Pressable).props.onPress).toBe(first);
    press(r); press(r); press(r);
    await settle();
    await t.flush();
    expect(taps(sent).map((x) => x["ui.rage"])).toEqual([undefined, undefined, true]);
  });

  it("off by default: the JSX runtime is never patched", async () => {
    const { TelemetryNative } = await import("./telemetryNative.native");
    const hook = vi.spyOn(TelemetryNative.prototype as any, "autoTrackTaps");
    await launch(false);
    expect(hook).not.toHaveBeenCalled();
    await launch(true);
    expect(hook).toHaveBeenCalledOnce();
  });
});
