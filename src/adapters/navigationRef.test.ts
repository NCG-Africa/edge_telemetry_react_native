import { describe, it, expect, vi } from "vitest";
import { NavigationRefTracker } from "./navigationRef";

// The ref listener itself: which route name it resolves, and when it decides a route changed.
// Shared by both builds as of #96, so the recursion below is the only place either build
// turns a React Navigation state tree into a `view.name`.

function harness() {
  const routes: Array<[string, string]> = [];
  const telemetry = {
    recordRouteChange: vi.fn(async (from: string, to: string) => { routes.push([from, to]); }),
  } as any;
  let listener: (() => void) | undefined;
  let current: any;
  const ref = {
    addListener: (_t: string, fn: () => void) => { listener = fn; },
    getCurrentRoute: () => current,
  };
  new NavigationRefTracker(telemetry).attach(ref);
  return { routes, go: (route: any) => { current = route; listener?.(); } };
}

describe("NavigationRefTracker", () => {
  it("reports the first route as coming from `init`", () => {
    const { routes, go } = harness();
    go({ name: "Home" });
    expect(routes).toEqual([["init", "Home"]]);
  });

  it("resolves the deepest focused route of a nested navigator", () => {
    const { routes, go } = harness();
    go({
      name: "Root",
      state: {
        index: 1,
        routes: [
          { name: "Login" },
          { name: "Tabs", state: { index: 2, routes: [{ name: "Feed" }, { name: "Search" }, { name: "Profile" }] } },
        ],
      },
    });
    expect(routes).toEqual([["init", "Profile"]]);
  });

  it("falls back to `unknown` rather than throwing when there is no current route", () => {
    const { routes, go } = harness();
    go(undefined);
    expect(routes).toEqual([["init", "unknown"]]);
  });

  it("fires once per actual change — a state event on the same route is ignored", () => {
    const { routes, go } = harness();
    go({ name: "Home" });
    go({ name: "Home" });        // a re-render, not a navigation
    go({ name: "Cart" });
    expect(routes).toEqual([["init", "Home"], ["Home", "Cart"]]);
  });

  it("advances `from` even though recordRouteChange is async — it never re-reports a stale one", () => {
    const { routes, go } = harness();
    go({ name: "A" });
    go({ name: "B" });
    go({ name: "C" });
    expect(routes.map(([from]) => from)).toEqual(["init", "A", "B"]);
  });

  it("does nothing at all without a ref", () => {
    const telemetry = { recordRouteChange: vi.fn() } as any;
    expect(() => new NavigationRefTracker(telemetry).attach(undefined)).not.toThrow();
    expect(telemetry.recordRouteChange).not.toHaveBeenCalled();
  });
});
