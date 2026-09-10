import { describe, it, expect } from "vitest";
import {
    RageTracker,
    UI_NAME_MAX,
    isActionable,
    isDeadClickExempt,
    normalizeUiName,
    resolveUiName,
    uiAttributes,
    type UiElement,
} from "./uiInteraction";

// The §4.6 rules that both builds share, tested against plain objects — the module reads
// elements structurally precisely so this needs no DOM.
function el(tag: string, attrs: Record<string, string> = {}, text?: string): UiElement {
    return {
        tagName: tag.toUpperCase(),
        getAttribute: (n: string) => (n in attrs ? attrs[n] : null),
        textContent: text ?? null,
    };
}

describe("normalizeUiName (rungs 2-5)", () => {
    it("trims, lowercases, folds non-alphanumerics and collapses runs", () => {
        expect(normalizeUiName("  Add To  Cart!! ")).toBe("add_to_cart");
    });

    it("caps at 64", () => {
        const name = normalizeUiName("a".repeat(200));
        expect(name).toHaveLength(UI_NAME_MAX);
    });

    it("reports nothing survived as empty", () => {
        expect(normalizeUiName("   ")).toBe("");
        expect(normalizeUiName("!!!")).toBe("");
        expect(normalizeUiName(null)).toBe("");
    });
});

describe("the role gate", () => {
    it("accepts the six semantic tags and the eight ARIA roles", () => {
        expect(isActionable(el("button"))).toBe(true);
        expect(isActionable(el("summary"))).toBe(true);
        expect(isActionable(el("option"))).toBe(true);
        expect(isActionable(el("a", { href: "/x" }))).toBe(true);
        expect(isActionable(el("input", { type: "submit" }))).toBe(true);
        expect(isActionable(el("div", { role: "menuitem" }))).toBe(true);
    });

    it("rejects the PII-carrying clickable div, a bare anchor and a text input", () => {
        expect(isActionable(el("div"))).toBe(false);
        expect(isActionable(el("a"))).toBe(false);           // no href
        expect(isActionable(el("input", { type: "text" }))).toBe(false);
    });
});

describe("resolveUiName — the five-rung ladder", () => {
    it("rung 1 wins over a nearer role-bearing element, unnormalized and uncapped", () => {
        const outer = el("div", { "data-edge-action-name": "Checkout — Step 2 of 3" });
        const button = el("button", { "aria-label": "Pay now" }, "Pay now");
        const r = resolveUiName([button, outer]);
        expect(r.target).toBe("Checkout — Step 2 of 3");   // byte-for-byte what the author set
        expect(r.nameSource).toBe("edge_action");
    });

    it("rung 1 reports the *click's* actionability, not the labelled wrapper's", () => {
        // An explicit name on a role-less wrapper around a real control must still be
        // judged for `ui.dead` — that is the population §4.6 most wants judged.
        const wrapper = el("div", { "data-edge-action-name": "pay" });
        expect(resolveUiName([el("button", {}, "Pay"), wrapper]).actionable).toBe(true);
        // No control anywhere in the path: nothing to judge.
        expect(resolveUiName([el("span"), wrapper]).actionable).toBe(false);
    });

    it("rung 1 works on a role-less element and is not capped by the 64-char rule", () => {
        const long = "X".repeat(200);
        const r = resolveUiName([el("div", { "data-edge-action-name": long })]);
        expect(r.target).toBe(long);
        expect(r.nameSource).toBe("edge_action");
    });

    it("rungs 2-5 run in order off the nearest actionable ancestor, normalized", () => {
        const order: Array<[Record<string, string>, string, string]> = [
            [{ "data-testid": "Pay Now" }, "pay_now", "test_id"],
            [{ "aria-label": "Pay Now" }, "pay_now", "aria_label"],
            [{ title: "Pay Now" }, "pay_now", "title"],
        ];
        for (const [attrs, target, nameSource] of order) {
            const r = resolveUiName([el("span", {}, "inner"), el("button", attrs, "Pay Now")]);
            expect([r.target, r.nameSource]).toEqual([target, nameSource]);
        }
        const text = resolveUiName([el("span", {}, "inner"), el("button", {}, "Pay Now")]);
        expect([text.target, text.nameSource]).toEqual(["pay_now", "text"]);
    });

    it("never derives a name from a role-less ancestor's attributes", () => {
        // The disease the role gate exists for: a clickable div labelled with customer data.
        const r = resolveUiName([el("div", { "aria-label": "John Kamau — 0712345678" })]);
        expect(r.target).toBe("surface");
        expect(r.nameSource).toBe("none");
    });

    it("emits `unnamed` for an actionable element no rung could name", () => {
        const r = resolveUiName([el("button", {}, "   ")]);
        expect(r.target).toBe("unnamed");
        expect(r.nameSource).toBe("none");
        expect(r.actionable).toBe(true);
    });

    it("separates the two role-less cases on the pointer cursor", () => {
        expect(resolveUiName([el("div")], { pointerCursor: true }).target).toBe("unnamed");
        expect(resolveUiName([el("div")], { pointerCursor: false }).target).toBe("surface");
    });

    it("reports ui.tag from the resolved element, not the click target", () => {
        const r = resolveUiName([el("span", {}, "buy"), el("button", {}, "buy")]);
        expect(r.tag).toBe("button");
    });
});

describe("isDeadClickExempt", () => {
    it("exempts text entry and download / _blank anchors", () => {
        expect(isDeadClickExempt(el("textarea"))).toBe(true);
        expect(isDeadClickExempt(el("input", { type: "email" }))).toBe(true);
        expect(isDeadClickExempt(el("div", { contenteditable: "true" }))).toBe(true);
        expect(isDeadClickExempt(el("a", { href: "/f.pdf", download: "" }))).toBe(true);
        expect(isDeadClickExempt(el("a", { href: "/x", target: "_blank" }))).toBe(true);
    });

    it("judges an ordinary button and same-tab link", () => {
        expect(isDeadClickExempt(el("button"))).toBe(false);
        expect(isDeadClickExempt(el("a", { href: "/x" }))).toBe(false);
    });

    it("does not exempt `contenteditable=\"false\"` — that is an ordinary element", () => {
        expect(isDeadClickExempt(el("div", { contenteditable: "false" }))).toBe(false);
        expect(isDeadClickExempt(el("div", { contenteditable: "" }))).toBe(true);
        expect(isDeadClickExempt(el("div", { contenteditable: "true" }))).toBe(true);
    });
});

describe("RageTracker", () => {
    const node = { id: "a" };

    it("flags the crossing click and only that one", () => {
        const rage = new RageTracker(1000);
        expect(rage.record(node, 0)).toBe(false);
        expect(rage.record(node, 100)).toBe(false);
        expect(rage.record(node, 200)).toBe(true);    // the 3rd — one flag per burst
        expect(rage.record(node, 300)).toBe(false);
        expect(rage.record(node, 400)).toBe(false);
    });

    it("keys on the node reference, never the derived name", () => {
        const rage = new RageTracker(1000);
        // Three different `unnamed` divs — indistinguishable on the wire, not rage.
        expect(rage.record({ id: 1 }, 0)).toBe(false);
        expect(rage.record({ id: 2 }, 100)).toBe(false);
        expect(rage.record({ id: 3 }, 200)).toBe(false);
    });

    it("does not fire once the window has slid past the earlier clicks", () => {
        const rage = new RageTracker(1000);
        rage.record(node, 0);
        rage.record(node, 900);
        expect(rage.record(node, 1900)).toBe(false);   // only two clicks are still inside
    });

    it("starts a new burst after the old one decays", () => {
        const rage = new RageTracker(1000);
        rage.record(node, 0);
        rage.record(node, 100);
        expect(rage.record(node, 200)).toBe(true);
        // Long gap, then three more: a second burst, flagged once again.
        rage.record(node, 10_000);
        rage.record(node, 10_100);
        expect(rage.record(node, 10_200)).toBe(true);
    });
});

describe("uiAttributes — the key block both builds share", () => {
    it("omits ui.rage when false and floors the coordinates §4.6 types never-null", () => {
        expect(uiAttributes({ type: "tap", target: "checkout", nameSource: "edge_action", tag: "native" }))
            .toEqual({
                "ui.type": "tap",
                "ui.target": "checkout",
                "ui.name_source": "edge_action",
                "ui.tag": "native",
                "ui.x": 0,
                "ui.y": 0,
            });
        expect(uiAttributes({ type: "click", target: "x", nameSource: "text", tag: "button", x: 10.6, y: 3.2, rage: true }))
            .toMatchObject({ "ui.x": 11, "ui.y": 3, "ui.rage": true });
    });
});
