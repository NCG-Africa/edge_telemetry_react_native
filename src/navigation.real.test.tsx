import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import TestRenderer, { act } from "react-test-renderer";
import {
  BaseNavigationContainer, createNavigationContainerRef, createNavigatorFactory,
  useNavigationBuilder, StackRouter, TabRouter,
} from "@react-navigation/core";
import type { TelemetryEvent } from "./core/telemetry";
import { memoryStore } from "./core/memoryStore";

// #170 — `attachNavigation` against a *real* React Navigation container and a real nested
// navigator, on both builds: the joined root-to-leaf name reaches the Sender, the initial
// screen is named without a single navigation, and params never leak into `view.name`.

vi.mock("react-native", () => ({ Dimensions: { get: () => ({ width: 390, height: 844 }) }, PixelRatio: { get: () => 3 }, Platform: { OS: "android" }, AppState: { currentState: "active", addEventListener: () => {} } }));
vi.mock("react-native-get-random-values", () => ({}));
vi.mock("react-native-device-info", () => ({ default: new Proxy({}, { get: () => async () => "x" }) }));
vi.mock("@react-native-community/netinfo", () => ({
  default: { fetch: async () => ({ type: "wifi", isConnected: true }), addEventListener: () => {} },
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/** The smallest real navigator: renders only the focused route, like a stack or tab bar does. */
function navigator(router: any): any {
  return (createNavigatorFactory as any)(function Navigator({ children, initialRouteName }: any) {
    const { state, descriptors, NavigationContent } = useNavigationBuilder(router, { children, initialRouteName });
    return <NavigationContent>{descriptors[state.routes[state.index].key].render()}</NavigationContent>;
  })();
}
const { Navigator: Stack, Screen } = navigator(StackRouter);
const { Navigator: Tabs } = navigator(TabRouter);
const Blank = () => null;

function HomeTab() {
  return <Stack><Screen name="Feed" component={Blank} /><Screen name="Details" component={Blank} /></Stack>;
}
function SearchTab() {
  return <Stack><Screen name="Results" component={Blank} /><Screen name="Details" component={Blank} /></Stack>;
}
function App({ navRef }: { navRef: any }) {
  return (
    <BaseNavigationContainer ref={navRef}>
      <Tabs>
        <Screen name="HomeTab" component={HomeTab} />
        <Screen name="SearchTab" component={SearchTab} />
      </Tabs>
    </BaseNavigationContainer>
  );
}

const settle = async () => { for (let i = 0; i < 50; i++) await new Promise((r) => setTimeout(r, 0)); };

for (const build of ["native", "web"] as const) {
  describe(`#170 attachNavigation against a real nested navigator (${build})`, () => {
    beforeEach(() => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => vi.restoreAllMocks());

    async function launch() {
      const { createTelemetry } = build === "native"
        ? await import("./createTelemetry.native")
        : await import("./createTelemetry.web");
      const sent: TelemetryEvent[] = [];
      const t = createTelemetry({
        apiKey: "edge_nav", endpoint: "https://x/telemetry",
        sender: { send: async (e: TelemetryEvent[]) => { sent.push(...e); } },
        store: memoryStore() as any, batchSize: 200, flushIntervalMs: 0,
      });
      await (t as any).instancePromise;
      return { t, sent };
    }

    const viewNames = (sent: TelemetryEvent[]) =>
      sent.filter((e) => e.eventName === "view").map((e) => e.attributes!["view.name"]);

    it("names the initial screen with no navigation, then the joined path on every change", async () => {
      const { t, sent } = await launch();
      const ref = createNavigationContainerRef<any>();
      let r!: TestRenderer.ReactTestRenderer;
      // Attached before mount: the ref is not ready, so the name arrives on `ready`.
      await t.attachNavigation(ref);
      await act(async () => { r = TestRenderer.create(<App navRef={ref} />); });
      await settle();

      await act(async () => { ref.navigate("HomeTab", { screen: "Details", params: { id: "acc_91" } }); });
      await settle();
      await act(async () => { ref.navigate("SearchTab", { screen: "Details", params: { id: "acc_92" } }); });
      await settle();
      await t.log("custom_event");
      await t.flush();

      expect(viewNames(sent)).toEqual(["HomeTab/Feed", "HomeTab/Details"]);
      const last = sent.find((e) => e.eventName === "custom_event")!;
      expect(last.attributes!["view.name"]).toBe("SearchTab/Details");
      expect(JSON.stringify(sent)).not.toMatch(/acc_9/);
      act(() => r.unmount());
    });

    it("attached to an already-ready ref, names the current screen immediately", async () => {
      const { t, sent } = await launch();
      const ref = createNavigationContainerRef<any>();
      let r!: TestRenderer.ReactTestRenderer;
      await act(async () => { r = TestRenderer.create(<App navRef={ref} />); });
      expect(ref.isReady()).toBe(true);
      await t.attachNavigation(ref);
      await settle();
      await t.log("custom_event");
      await t.flush();

      expect(sent.find((e) => e.eventName === "custom_event")!.attributes!["view.name"]).toBe("HomeTab/Feed");
      act(() => r.unmount());
    });
  });
}
