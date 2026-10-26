import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import TestRenderer, { act } from "react-test-renderer";
import type { TelemetryEvent } from "./core/telemetry";
import { memoryStore } from "./core/memoryStore";
import { markBoundaryCaught } from "./adapters/crashCapture";

// #166 — Seam 3: the React surface rendered through react-test-renderer, on both builds, with
// the assertions still on what reaches the Sender.

vi.mock("react-native", () => ({ Dimensions: { get: () => ({ width: 390, height: 844 }) }, PixelRatio: { get: () => 3 }, Platform: { OS: "android" }, AppState: { currentState: "active", addEventListener: () => {} } }));
vi.mock("react-native-get-random-values", () => ({}));
vi.mock("react-native-device-info", () => ({ default: new Proxy({}, { get: () => async () => "x" }) }));
vi.mock("@react-native-community/netinfo", () => ({
  default: { fetch: async () => ({ type: "wifi", isConnected: true }), addEventListener: () => {} },
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

const g = globalThis as any;
g.IS_REACT_ACT_ENVIRONMENT = true;
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0)); };

function Bomb({ error }: { error: unknown }): React.ReactElement {
  throw error;
}

for (const build of ["native", "web"] as const) {
  describe(`#166 <EdgeErrorBoundary> (${build})`, () => {
    const saved = { error: console.error, warn: console.warn, log: console.log, window: g.window, ErrorUtils: g.ErrorUtils };
    let globalHandler: ((e: unknown, fatal?: boolean) => void) | undefined;
    const rnDefault = vi.fn();
    beforeEach(() => {
      console.error = () => {};
      console.warn = () => {};
      console.log = () => {};
      rnDefault.mockClear();
      if (build === "web") g.window = {};
      else g.ErrorUtils = { setGlobalHandler: (fn: any) => { globalHandler = fn; }, getGlobalHandler: () => rnDefault };
    });
    afterEach(() => {
      Object.assign(console, { error: saved.error, warn: saved.warn, log: saved.log });
      g.window = saved.window;
      g.ErrorUtils = saved.ErrorUtils;
    });

    async function launch() {
      const mod = build === "native" ? await import("./index.native") : await import("./index.web");
      const sent: TelemetryEvent[] = [];
      const t = mod.createTelemetry({
        apiKey: "edge_boundary", endpoint: "https://x/telemetry",
        sender: { send: async (e: TelemetryEvent[]) => { sent.push(...e); } },
        store: memoryStore() as any, batchSize: 500, flushIntervalMs: 0, captureConsole: true,
      });
      await (t as any).instancePromise;
      await settle();
      return { t, sent, EdgeErrorBoundary: mod.EdgeErrorBoundary };
    }
    // react-test-renderer's own deprecation console.error is a real `console` row; it is noise here.
    const errors = (sent: TelemetryEvent[]) => sent.filter((e) =>
      (e.eventName === "app.error" || e.eventName === "app.crash")
      && !String(e.attributes!["error.message"]).includes("react-test-renderer is deprecated"));
    const globalThrow = (error: unknown) =>
      build === "web" ? g.window.onerror("Uncaught", "", 0, 0, error) : globalHandler!(error, false);

    it("one caught render error is one app.error — source boundary, component stack, never app.crash", async () => {
      const { t, sent, EdgeErrorBoundary } = await launch();
      const boom = new TypeError("kaboom");
      const order: string[] = [];
      let r!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        r = TestRenderer.create(
          <EdgeErrorBoundary telemetry={t} fallback={<>sorry</>} onError={() => { order.push("onError"); throw new Error("host bug"); }}>
            <Bomb error={boom} />
          </EdgeErrorBoundary>,
        );
      });
      // React's own reporting, and a dev rethrow to the global handler, both skip it.
      console.error(boom);
      globalThrow(boom);
      await settle();
      await t.flush();

      const [row, ...more] = errors(sent);
      expect(more).toEqual([]);
      expect(row.eventName).toBe("app.error");
      expect(row.attributes).toMatchObject({ "error.source": "boundary", "error.type": "TypeError", "error.message": "kaboom" });
      expect(row.attributes!["error.component_stack"]).toMatch(/Bomb/);
      expect(order).toEqual(["onError"]);
      expect(r.toJSON()).toBe("sorry");
      if (build === "native") expect(rnDefault).toHaveBeenCalledWith(boom, false);   // RN's own handler still runs
    });

    it("fallback as a render function gets the error and a reset", async () => {
      const { t, sent, EdgeErrorBoundary } = await launch();
      let explode = true;
      function Maybe() { if (explode) throw new Error("once"); return <>ok</>; }
      let r!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        r = TestRenderer.create(
          <EdgeErrorBoundary telemetry={t} fallback={({ error, resetError }) =>
            <>{`failed: ${(error as Error).message}`}<Reset onReset={() => { explode = false; resetError(); }} /></>
          }>
            <Maybe />
          </EdgeErrorBoundary>,
        );
      });
      expect(r.toJSON()).toContain("failed: once");
      await act(async () => { r.root.findByType(Reset).props.onReset(); });
      expect(r.toJSON()).toBe("ok");
      await settle();
      await t.flush();
      expect(errors(sent)).toHaveLength(1);
    });

    // React ≤18's dev build replays a failed render inside invokeGuardedCallback, so `window.onerror`
    // fires *before* getDerivedStateFromError marks the error — same task, earlier line.
    if (build === "web") it("React ≤18 dev order: global handler before the mark is still one row", async () => {
      const { t, sent } = await launch();
      const boom = new Error("replayed");
      globalThrow(boom);
      markBoundaryCaught(boom);
      await settle();
      await t.flush();
      expect(errors(sent)).toEqual([]);
    });

    it("an error the boundary did not catch is still reported by the global handler", async () => {
      const { t, sent } = await launch();
      globalThrow(new Error("elsewhere"));
      await settle();
      await t.flush();
      expect(errors(sent).map((e) => e.eventName)).toEqual(["app.crash"]);
    });
  });
}

function Reset(_: { onReset: () => void }) { return null; }
