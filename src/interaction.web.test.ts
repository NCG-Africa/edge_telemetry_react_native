import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createTelemetry } from "./createTelemetry.web";
import type { TelemetryEvent } from "./core/telemetry";

// #102 / §4.6 — `ui.interaction` asserted where the contract lives: the TelemetryEvent[] that
// reaches the injected Sender. Keys, values and **absence** — `ui.rage` is omitted when false
// and `ui.dead` is omitted when not evaluated, and those two absences mean different things.
//
// The DOM is stubbed rather than emulated: this repo runs vitest under node, and the ladder's
// own rules are covered in `adapters/uiInteraction.test.ts` against plain objects.

const g = global as any;
const saved = {
    document: g.document,
    MutationObserver: g.MutationObserver,
    getComputedStyle: g.getComputedStyle,
    window: g.window,
};

/** A click listener registry plus the two globals the tracker feature-detects. */
function installDom(opts: { pointerCursor?: boolean } = {}) {
    const clickHandlers: Array<(e: any) => void> = [];
    const observers: Array<{ cb: () => void; connected: boolean }> = [];

    const visibilityHandlers: Array<() => void> = [];
    const pagehideHandlers: Array<() => void> = [];

    g.document = {
        documentElement: { nodeType: 1 },
        visibilityState: "visible",
        addEventListener: (type: string, cb: any) => {
            if (type === "click") clickHandlers.push(cb);
            if (type === "visibilitychange") visibilityHandlers.push(cb);
        },
        removeEventListener: () => { },
    };
    g.window = {
        addEventListener: (type: string, cb: any) => { if (type === "pagehide") pagehideHandlers.push(cb); },
        removeEventListener: () => { },
    };
    g.MutationObserver = class {
        constructor(private cb: () => void) { observers.push({ cb, connected: false }); }
        observe() { observers[observers.length - 1].connected = true; }
        disconnect() { observers.forEach(o => { o.connected = false; }); }
    };
    g.getComputedStyle = () => ({ cursor: opts.pointerCursor ? "pointer" : "default" });

    return {
        click: (path: any[], at: { x: number; y: number } = { x: 10, y: 20 }) => {
            const e = { composedPath: () => path, target: path[0], clientX: at.x, clientY: at.y };
            clickHandlers.forEach(h => h(e));
        },
        /** Fire every live observer, i.e. "the app responded to the click". */
        mutate: () => observers.filter(o => o.connected).forEach(o => o.cb()),
        /** A same-tab link unloading the document while a window is still open. */
        pagehide: () => pagehideHandlers.forEach(h => h()),
        hide: () => { g.document.visibilityState = "hidden"; visibilityHandlers.forEach(h => h()); },
        get attached() { return clickHandlers.length; },
    };
}

function el(tag: string, attrs: Record<string, string> = {}, text?: string) {
    return {
        tagName: tag.toUpperCase(),
        getAttribute: (n: string) => (n in attrs ? attrs[n] : null),
        textContent: text ?? null,
    };
}

function silenceConsole() {
    vi.spyOn(console, "log").mockImplementation(() => { });
    vi.spyOn(console, "warn").mockImplementation(() => { });
    vi.spyOn(console, "error").mockImplementation(() => { });
}

function harness(extra: Record<string, any> = {}) {
    const sent: TelemetryEvent[] = [];
    const t = createTelemetry({
        apiKey: "edge_k", endpoint: "https://x/telemetry",
        sender: { send: async (e: TelemetryEvent[]) => { sent.push(...e); } },
        batchSize: 500, flushIntervalMs: 0,
        ...extra,
    });
    return { t, sent };
}

/** Let the ctor's fire-and-forget trackInteractions() finish its dynamic import and attach. */
async function settle(t: any) {
    await t.instancePromise;
    for (let i = 0; i < 30; i++) await Promise.resolve();
}

const clicks = (sent: TelemetryEvent[]) => sent.filter(e => e.eventName === "ui.interaction");

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    Object.assign(g, saved);
});

describe("ui.interaction (web) — the wire (§4.6)", () => {
    it("attaches exactly one click listener however often trackInteractions() is called", async () => {
        silenceConsole();
        const dom = installDom();
        const { t, sent } = harness();
        await settle(t);
        await (t as any).trackInteractions();
        await (t as any).trackInteractions();
        expect(dom.attached).toBe(1);

        dom.click([el("button", {}, "Buy")]);
        await vi.advanceTimersByTimeAsync(1000);
        await t.flush();
        expect(clicks(sent)).toHaveLength(1);   // one row, not three
    });

    it("emits the eight keys, with `ui.tag` from the resolved element", async () => {
        silenceConsole();
        const dom = installDom();
        const { t, sent } = harness();
        await settle(t);
        expect(dom.attached).toBe(1);

        dom.click([el("span", {}, "Pay now"), el("button", { "aria-label": "Pay Now" }, "Pay now")], { x: 33, y: 77 });
        await vi.advanceTimersByTimeAsync(1000);   // the dead-click window
        await t.flush();

        const a = clicks(sent)[0].attributes!;
        expect(a["ui.type"]).toBe("click");
        expect(a["ui.target"]).toBe("pay_now");
        expect(a["ui.name_source"]).toBe("aria_label");
        expect(a["ui.tag"]).toBe("button");
        expect(a["ui.x"]).toBe(33);
        expect(a["ui.y"]).toBe(77);
        // `user.interaction` is retired: it must not survive anywhere on the wire.
        expect(sent.some(e => e.eventName === "user.interaction")).toBe(false);
    });

    it("`data-edge-action-name` ships unnormalized and uncapped", async () => {
        silenceConsole();
        const dom = installDom();
        const { t, sent } = harness();
        await settle(t);

        const raw = "Checkout — Step 2 of 3";
        dom.click([el("div", { "data-edge-action-name": raw })]);
        await vi.advanceTimersByTimeAsync(1000);
        await t.flush();

        const a = clicks(sent)[0].attributes!;
        expect(a["ui.target"]).toBe(raw);
        expect(a["ui.name_source"]).toBe("edge_action");
    });

    it("emits every click, and separates `surface` from `unnamed`", async () => {
        silenceConsole();
        const dom = installDom({ pointerCursor: false });
        const { t, sent } = harness();
        await settle(t);

        dom.click([el("div", {}, "some copy")]);            // role-less, default cursor
        dom.click([el("button", {}, "  ")]);                // actionable, nothing to name
        await vi.advanceTimersByTimeAsync(1000);
        await t.flush();

        const rows = clicks(sent);
        expect(rows).toHaveLength(2);
        expect(rows.map(r => r.attributes!["ui.target"])).toEqual(["surface", "unnamed"]);
        expect(rows.every(r => r.attributes!["ui.name_source"] === "none")).toBe(true);
    });

    it("a role-less pointer-cursor click is `unnamed`, not `surface`", async () => {
        silenceConsole();
        const dom = installDom({ pointerCursor: true });
        const { t, sent } = harness();
        await settle(t);

        dom.click([el("div", {}, "clickable")]);
        await vi.advanceTimersByTimeAsync(1000);
        await t.flush();

        expect(clicks(sent)[0].attributes!["ui.target"]).toBe("unnamed");
    });

    it("mints an interaction root, and the next request is its child", async () => {
        silenceConsole();
        const dom = installDom();
        const { t, sent } = harness();
        await settle(t);

        dom.click([el("button", {}, "Buy")]);
        const inst = await (t as any).instancePromise;
        // A request the tap fired, one tick later — Tier 1, captured at send.
        const child = inst.trace.requestTrace(Date.now(), { url: "https://api.x/pay", sampled: true }).finish(Date.now());
        await vi.advanceTimersByTimeAsync(1000);
        await t.flush();

        const a = clicks(sent)[0].attributes!;
        expect(a["trace.root_type"]).toBe("interaction");
        expect(a["span.id"]).toBe(a["rum.action.id"]);      // a root
        expect("parent.span.id" in a).toBe(false);
        expect("span.duration_ms" in a).toBe(false);        // roots derive theirs server-side

        expect(child["trace.id"]).toBe(a["trace.id"]);
        expect(child["parent.span.id"]).toBe(a["rum.action.id"]);
        expect(child["trace.root_type"]).toBe("interaction");
    });

    it("reports the mint time and the *previous* view when the tap navigates", async () => {
        silenceConsole();
        const dom = installDom();
        const { t, sent } = harness();
        await settle(t);
        const inst = await (t as any).instancePromise;

        // Name the current view first, so the arriving route is the *same* rung and
        // therefore a genuine navigation that mints a successor (§4.5.1).
        await inst.recordRouteChange("", "Home");
        const before = { id: inst.views.id, name: inst.views.name, at: Date.now() };

        dom.click([el("button", {}, "Go to cart")]);
        // The host's own handler navigates — while the dead-click window is still open.
        await inst.recordRouteChange("Home", "Cart");
        expect(inst.views.id).not.toBe(before.id);
        expect(inst.views.name).toBe("Cart");

        await vi.advanceTimersByTimeAsync(1000);
        await t.flush();

        const row = clicks(sent)[0];
        expect(row.attributes!["view.id"]).toBe(before.id);          // the view it happened in
        expect(row.attributes!["view.name"]).toBe("Home");           // never the view it opened
        expect(Date.parse(row.timestamp)).toBe(before.at);           // mint time, not emit time
    });

    it("flags `ui.rage` once per burst on one node, and omits it otherwise", async () => {
        silenceConsole();
        const dom = installDom();
        const { t, sent } = harness();
        await settle(t);

        const node = el("button", {}, "Submit");
        dom.click([node]);
        await vi.advanceTimersByTimeAsync(100);
        dom.click([node]);
        await vi.advanceTimersByTimeAsync(100);
        dom.click([node]);           // the crossing click
        await vi.advanceTimersByTimeAsync(100);
        dom.click([node]);           // same burst, no second flag
        await vi.advanceTimersByTimeAsync(1000);
        await t.flush();

        const flags = clicks(sent).map(r => r.attributes!["ui.rage"]);
        expect(flags.filter(f => f === true)).toHaveLength(1);
        expect(clicks(sent).filter(r => "ui.rage" in r.attributes!)).toHaveLength(1);
    });

    it("does not flag rage for three different nodes sharing a derived name", async () => {
        silenceConsole();
        const dom = installDom();
        const { t, sent } = harness();
        await settle(t);

        // Three separate `unnamed` divs — identical on the wire, three distinct nodes.
        for (let i = 0; i < 3; i++) {
            dom.click([el("button", {}, "  ")]);
            await vi.advanceTimersByTimeAsync(100);
        }
        await vi.advanceTimersByTimeAsync(1000);
        await t.flush();

        expect(clicks(sent).some(r => "ui.rage" in r.attributes!)).toBe(false);
    });
});

describe("the deferred row survives the page it was clicked on", () => {
    it("drains open windows on pagehide, with `ui.dead` omitted — the window never closed", async () => {
        silenceConsole();
        const dom = installDom();
        const { t, sent } = harness();
        await settle(t);

        // A same-tab <a href>: the host navigates and the document unloads mid-window.
        dom.click([el("a", { href: "/cart" }, "Go to cart")]);
        dom.pagehide();
        await vi.advanceTimersByTimeAsync(0);   // let the enqueue's own microtasks run
        await t.flush();

        const rows = clicks(sent);
        expect(rows).toHaveLength(1);                       // the row is NOT lost
        expect(rows[0].attributes!["ui.target"]).toBe("go_to_cart");
        expect("ui.dead" in rows[0].attributes!).toBe(false);   // not evaluated, so absent
    });

    it("does not double-emit when the timer would also have fired", async () => {
        silenceConsole();
        const dom = installDom();
        const { t, sent } = harness();
        await settle(t);

        dom.click([el("button", {}, "Retry")]);
        dom.hide();
        await vi.advanceTimersByTimeAsync(2000);
        await t.flush();

        expect(clicks(sent)).toHaveLength(1);
    });
});

describe("ui.dead (§4.6) — under-reports, never falsely accuses", () => {
    it("is true when nothing happened inside the window", async () => {
        silenceConsole();
        const dom = installDom();
        const { t, sent } = harness();
        await settle(t);

        dom.click([el("button", {}, "Retry")]);
        await vi.advanceTimersByTimeAsync(1000);
        await t.flush();

        expect(clicks(sent)[0].attributes!["ui.dead"]).toBe(true);
    });

    it("is false after an attribute-only mutation — a CSS class flip is alive", async () => {
        silenceConsole();
        const dom = installDom();
        const { t, sent } = harness();
        await settle(t);

        dom.click([el("button", {}, "Retry")]);
        await vi.advanceTimersByTimeAsync(200);
        dom.mutate();
        await vi.advanceTimersByTimeAsync(1000);
        await t.flush();

        expect(clicks(sent)[0].attributes!["ui.dead"]).toBe(false);
    });

    it("is false when a request started inside the window", async () => {
        silenceConsole();
        const dom = installDom();
        const { t, sent } = harness();
        await settle(t);
        const inst = await (t as any).instancePromise;

        dom.click([el("button", {}, "Search")]);
        await vi.advanceTimersByTimeAsync(200);
        inst.views.requestStarted();
        await vi.advanceTimersByTimeAsync(1000);
        await t.flush();

        expect(clicks(sent)[0].attributes!["ui.dead"]).toBe(false);
    });

    it("is omitted entirely on a non-actionable click, on text entry and on a download anchor", async () => {
        silenceConsole();
        const dom = installDom();
        const { t, sent } = harness();
        await settle(t);

        dom.click([el("div", {}, "whitespace")]);
        dom.click([el("input", { type: "text" })]);
        dom.click([el("a", { href: "/f.pdf", download: "" })]);
        await vi.advanceTimersByTimeAsync(1000);
        await t.flush();

        const rows = clicks(sent);
        expect(rows).toHaveLength(3);
        expect(rows.every(r => !("ui.dead" in r.attributes!))).toBe(true);
    });

    it("is omitted when there is no MutationObserver to evaluate it with", async () => {
        silenceConsole();
        const dom = installDom();
        g.MutationObserver = undefined;
        const { t, sent } = harness();
        await settle(t);

        dom.click([el("button", {}, "Retry")]);
        await vi.advanceTimersByTimeAsync(1000);
        await t.flush();

        const a = clicks(sent)[0].attributes!;
        expect(a["ui.target"]).toBe("retry");       // the row still ships
        expect("ui.dead" in a).toBe(false);
    });
});
