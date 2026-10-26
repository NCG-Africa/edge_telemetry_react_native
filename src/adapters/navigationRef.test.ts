import { describe, it, expect, vi } from "vitest";
import { NavigationRefTracker, routePath } from "./navigationRef";

// The ref listener itself (#170): which route path it resolves, and when it decides a route
// changed. The proof against a *real* React Navigation container is navigation.real.test.tsx.

function harness(ready = true) {
  const routes: string[] = [];
  const telemetry = { recordRouteChange: vi.fn(async (to: string) => { routes.push(to); }) } as any;
  const listeners: Record<string, () => void> = {};
  let root: any;
  const ref = {
    addListener: (t: string, fn: () => void) => { listeners[t] = fn; },
    getRootState: () => root,
    isReady: () => ready,
  };
  const set = (state: any) => { root = state; };
  return { routes, ref, set, telemetry, fire: (t: string) => listeners[t]?.() };
}

const stack = (index: number, ...routes: any[]) => ({ index, routes });

describe("routePath — the root-to-leaf join (#170)", () => {
  it("joins focused route names with `/`, never normalized, params never read", () => {
    const ref = {
      getRootState: () => stack(1,
        { name: "Login" },
        { name: "Tabs", state: stack(0, { name: "Step 2 of 3", params: { id: "acc_91" } }) }),
    };
    expect(routePath(ref)).toBe("Tabs/Step 2 of 3");
  });

  it("yields the Expo Router file-path template", () => {
    const ref = { getRootState: () => stack(0, { name: "(tabs)", state: stack(1, { name: "index" }, { name: "settings/index" }) }) };
    expect(routePath(ref)).toBe("(tabs)/settings/index");
  });

  it("takes the last route of a partial state with no index, and falls back to the leaf, then `unknown`", () => {
    expect(routePath({ getRootState: () => ({ routes: [{ name: "A" }, { name: "B" }] }) })).toBe("B");
    expect(routePath({ getCurrentRoute: () => ({ name: "Leaf" }) })).toBe("Leaf");
    expect(routePath({})).toBe("unknown");
  });
});

describe("NavigationRefTracker", () => {
  it("names the current screen at once when the ref is ready", () => {
    const h = harness(true);
    h.set(stack(0, { name: "Home" }));
    new NavigationRefTracker(h.telemetry).attach(h.ref);
    expect(h.routes).toEqual(["Home"]);
  });

  it("waits for the ref's `ready` event when it is not ready yet", () => {
    const h = harness(false);
    new NavigationRefTracker(h.telemetry).attach(h.ref);
    expect(h.routes).toEqual([]);
    h.set(stack(0, { name: "Home" }));
    h.fire("ready");
    expect(h.routes).toEqual(["Home"]);
  });

  it("fires once per actual change — a state event on the same route is ignored", () => {
    const h = harness(false);
    new NavigationRefTracker(h.telemetry).attach(h.ref);
    h.set(stack(0, { name: "Home" })); h.fire("state");
    h.set(stack(0, { name: "Home", params: { x: 1 } })); h.fire("state");
    h.set(stack(1, { name: "Home" }, { name: "Cart" })); h.fire("state");
    expect(h.routes).toEqual(["Home", "Cart"]);
  });

  it("does nothing at all without a ref", () => {
    const telemetry = { recordRouteChange: vi.fn() } as any;
    expect(() => new NavigationRefTracker(telemetry).attach(undefined)).not.toThrow();
    expect(telemetry.recordRouteChange).not.toHaveBeenCalled();
  });
});
