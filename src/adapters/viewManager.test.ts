import { describe, it, expect } from "vitest";
import { ViewManager, UNKNOWN_VIEW_NAME, MAX_RETIRED_VIEW_NAMES } from "./viewManager";

// The name ladder (§4.5.1) in isolation. "Rank beats order" is the whole rule and it is the
// one thing a later refactor can silently invert, so it is asserted rung by rung.

function manager() {
  const logged: Array<{ name: string; data: any }> = [];
  const vm = new ViewManager({ log: (name: string, data?: any) => { logged.push({ name, data }); } });
  return { vm, logged };
}

describe("ViewManager — the name ladder", () => {
  it("opens an initial view named `unknown` from source `none`, never an absent one", () => {
    const { vm } = manager();
    expect(vm.name).toBe(UNKNOWN_VIEW_NAME);
    expect(vm.id).toMatch(/^view_\d+_[0-9a-f]{16}$/);
  });

  it("a higher rung re-stamps the name and leaves view.id alone (rank beats order)", async () => {
    const { vm, logged } = manager();
    await vm.navigate("/dashboard/{id}", "url");
    const id = vm.id;

    await vm.navigate("Dashboard", "route");
    expect(vm.name).toBe("Dashboard");
    expect(vm.id).toBe(id);            // an upgrade, not a navigation

    await vm.navigate("Overview", "explicit");
    expect(vm.name).toBe("Overview");
    expect(vm.id).toBe(id);
    expect(logged).toHaveLength(0);    // no view exited, so no `view` event
  });

  it("a lower rung arriving later does not overwrite a higher one", async () => {
    const { vm, logged } = manager();
    await vm.navigate("Checkout", "route");
    const id = vm.id;

    await vm.navigate("/checkout/7781", "url");
    expect(vm.name).toBe("Checkout");
    expect(vm.id).toBe(id);
    expect(logged).toHaveLength(0);
  });

  it("the same rung naming a different screen is a navigation: it emits and mints", async () => {
    const { vm, logged } = manager();
    await vm.navigate("Home", "route");
    const first = vm.id;

    await vm.navigate("Details", "route");
    expect(vm.id).not.toBe(first);
    expect(vm.name).toBe("Details");
    expect(logged.map((l) => l.name)).toEqual(["view"]);
    expect(logged[0].data["view.name_source"]).toBe("route");
    expect(logged[0].data["view.load_type"]).toBe("initial_load");   // the view that just ended
    expect(logged[0].data["view.referrer"]).toBe("");                // first view of the process
  });

  it("the same rung naming the same screen changes nothing", async () => {
    const { vm, logged } = manager();
    await vm.navigate("Home", "route");
    const id = vm.id;
    await vm.navigate("Home", "route");
    expect(vm.id).toBe(id);
    expect(logged).toHaveLength(0);
  });

  it("rungs 1 and 2 pass through unnormalized — a host's `Step 2 of 3` survives verbatim", async () => {
    const { vm } = manager();
    await vm.navigate("Step 2 of 3", "explicit");
    expect(vm.name).toBe("Step 2 of 3");

    const other = manager();
    await other.vm.navigate("Order2024Confirm", "route");
    expect(other.vm.name).toBe("Order2024Confirm");
  });

  it("screenStart's rung overrides a derived name without splitting the view", async () => {
    const { vm, logged } = manager();
    await vm.navigate("/orders/9", "url");
    const id = vm.id;
    await vm.navigate("Order detail", "explicit");
    expect(vm.name).toBe("Order detail");
    expect(vm.id).toBe(id);
    expect(logged).toHaveLength(0);
  });

  it("carries the referrer and the three counters onto the emitted view event", async () => {
    const { vm, logged } = manager();
    await vm.navigate("Home", "route");
    vm.countError(); vm.countError();
    vm.countAction();
    // request_count is booked at *send*, not at completion (§4.5.2) — the interceptors call
    // this, and the returned callback is what closes the request's hold on the view.
    vm.requestStarted(); vm.requestStarted(); vm.requestStarted();

    await vm.navigate("Cart", "route");
    const [{ data }] = logged;
    expect(data["view.error_count"]).toBe(2);
    expect(data["view.action_count"]).toBe(1);
    expect(data["view.request_count"]).toBe(3);
    expect(typeof data["view.time_spent"]).toBe("number");
    // Counters are per view, so the successor starts at zero.
    await vm.navigate("Checkout", "route");
    expect(logged[1].data["view.error_count"]).toBe(0);
    expect(logged[1].data["view.referrer"]).toBe("Home");
    expect(logged[1].data["view.load_type"]).toBe("route_change");
  });

  it("background emits, mints a `resume` successor, and stops the dwell clock", async () => {
    const { vm, logged } = manager();
    await vm.navigate("Home", "route");
    const before = vm.id;

    await vm.background();
    expect(vm.id).not.toBe(before);
    expect(logged.map((l) => l.name)).toEqual(["view"]);

    // Paused: nothing accrues while backgrounded, however long it lasts.
    await new Promise((r) => setTimeout(r, 20));
    vm.foreground();
    await vm.navigate("Cart", "route");
    expect(logged[1].data["view.load_type"]).toBe("resume");
    expect(logged[1].data["view.time_spent"]).toBeLessThan(20);
  });
});

// §5.1's boundary seam. The ordering is the contract: a subscriber runs while the departing
// view is still current, so anything it emits is booked against the screen that was leaving.
describe("ViewManager — onBoundary (§5.1)", () => {
  it("runs subscribers before the successor mints, and awaits them", async () => {
    const { vm } = manager();
    await vm.navigate("Home", "route");
    const home = vm.id;

    const seen: string[] = [];
    vm.onBoundary(async () => {
      await Promise.resolve();
      seen.push(vm.id);              // resolved after an await — still the departing view
    });

    await vm.navigate("Cart", "route");
    expect(seen).toEqual([home]);
    expect(vm.id).not.toBe(home);
  });

  it("fires on the route-change and background boundaries, and stops after unsubscribe", async () => {
    const { vm } = manager();
    let hits = 0;
    const off = vm.onBoundary(() => { hits++; });

    await vm.navigate("Home", "route");   // rung 2 over rung 0 is an upgrade, not a boundary
    expect(hits).toBe(0);

    await vm.navigate("Cart", "route");   // same rung, new name — a real navigation
    await vm.background();                // the background boundary
    expect(hits).toBe(2);

    off();
    await vm.navigate("Checkout", "route");
    expect(hits).toBe(2);
  });

  // The new session.id is installed before the successor mints, so a row emitted here would
  // pair it with the departing view.id — what §4.5's "view.id never spans a session.id" bars.
  it("does not fire on the session_rotation boundary", async () => {
    const { vm } = manager();
    let hits = 0;
    vm.onBoundary(() => { hits++; });

    await vm.beginView("session_rotation");
    expect(hits).toBe(0);
  });

  it("swallows a throwing subscriber rather than aborting the view mint", async () => {
    const { vm } = manager();
    await vm.navigate("Home", "route");
    const home = vm.id;
    vm.onBoundary(() => { throw new Error("frame window is broken"); });

    await vm.navigate("Cart", "route");
    expect(vm.id).not.toBe(home);
    expect(vm.name).toBe("Cart");
  });
});

// §3.1 (#108) — `view.name` for a **frozen** `view.id`. A span-carrying row pins itself to
// the view live at span start; the name is still resolved at log time, so this lookup is
// what stops a row carrying a name that disagrees with its own id.
describe("nameOf — §3.1's log-time lookup on a frozen view.id", () => {
  it("returns the live view's current name, so a rung upgrade shows through", async () => {
    const { vm } = manager();
    await vm.navigate("cart", "route");
    const frozen = vm.id;

    await vm.navigate("Shopping cart", "explicit");   // upgrade: same id, better name
    expect(vm.id).toBe(frozen);
    expect(vm.nameOf(frozen)).toBe("Shopping cart");
  });

  it("returns a retired view's final name after a real navigation", async () => {
    const { vm } = manager();
    await vm.navigate("Cart", "route");
    const cart = vm.id;

    await vm.navigate("Checkout", "route");           // same rung, new name: a navigation
    expect(vm.id).not.toBe(cart);
    expect(vm.nameOf(cart)).toBe("Cart");
    expect(vm.nameOf(vm.id)).toBe("Checkout");
  });

  it("degrades to the unknown literal for an id it never saw", () => {
    const { vm } = manager();
    expect(vm.nameOf("view_1_deadbeefdeadbeef")).toBe(UNKNOWN_VIEW_NAME);
  });

  it("keeps the last MAX_RETIRED_VIEW_NAMES retired names and evicts the oldest", async () => {
    const { vm } = manager();
    await vm.navigate("screen-0", "route");
    const oldest = vm.id;

    // One boundary past the bound, so `oldest` is the one entry that falls off the ring.
    for (let i = 1; i <= MAX_RETIRED_VIEW_NAMES + 1; i++) await vm.navigate(`screen-${i}`, "route");

    expect(vm.nameOf(oldest)).toBe(UNKNOWN_VIEW_NAME);
    // and the ring still names everything inside the bound
    expect(vm.nameOf(vm.id)).toBe(`screen-${MAX_RETIRED_VIEW_NAMES + 1}`);
  });
});
