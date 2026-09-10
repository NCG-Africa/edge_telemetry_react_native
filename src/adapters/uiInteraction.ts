// `ui.interaction`'s name ladder, role gate and rage window (§4.6, #102) — the platform-free
// half, so the web wiring and #103's native `trackTap` cannot drift on the rules.
//
// Elements are duck-typed (`tagName`, `getAttribute`, `textContent`) rather than typed as
// `Element`: the native build compiles this file too and has no DOM lib, and it makes the
// ladder testable against plain objects instead of a headless browser.

/** Rungs 2-5 are capped at 64 (§4.6). Rung 1 is not — see `resolveUiName`. */
export const UI_NAME_MAX = 64;

/**
 * §4.6's three unnamed values, two of which live here. `unnamed` is an **instrumentation
 * gap someone should close**; `surface` is whitespace with nothing to fix. Collapsing them
 * into one recreates the original disease in miniature — `40% unnamed` with no way to tell
 * a missing `data-edge-action-name` from people tapping padding.
 */
export const UI_UNNAMED = "unnamed";
export const UI_SURFACE = "surface";

/** Six values on web, two (`edge_action | none`) on native (§4.6). */
export type UiNameSource =
    | "edge_action"
    | "test_id"
    | "aria_label"
    | "title"
    | "text"
    | "none";

/** The bare minimum of an element this module reads. */
export type UiElement = {
    tagName?: string;
    getAttribute?(name: string): string | null;
    textContent?: string | null;
};

/**
 * §4.6's role gate: `<button>`, `<a href>`, `<input type=submit|button|reset>`, `<summary>`,
 * `<option>`, or an explicit ARIA role.
 *
 * ⚠ **A proxy, not a privacy guarantee.** `<button>Delete John Kamau</button>` still ships
 * that text; `beforeSend` is the answer and there is deliberately **no second per-element
 * masking mechanism** (§4.6). What the gate buys is that the PII-carrying clickable `<div>`
 * — which sets no role — is never auto-named. On RN-Web `createDOMProps` maps the `role`
 * prop to an analogous semantic element, so a `Pressable` lands here automatically.
 */
const ACTIONABLE_ROLES = new Set([
    "button", "link", "tab", "checkbox", "radio", "switch", "menuitem", "option",
]);
const ACTIONABLE_INPUT_TYPES = new Set(["submit", "button", "reset"]);

export function isActionable(el: UiElement | undefined | null): boolean {
    if (!el) return false;
    const role = attr(el, "role")?.trim().toLowerCase();
    if (role && ACTIONABLE_ROLES.has(role)) return true;
    switch (tagOf(el)) {
        case "button":
        case "summary":
        case "option":
            return true;
        case "a":
            return attr(el, "href") != null;
        case "input":
            return ACTIONABLE_INPUT_TYPES.has((attr(el, "type") ?? "").trim().toLowerCase());
        default:
            return false;
    }
}

/**
 * Text entry and downloads are excluded from dead-click judgement (§4.6): typing mutates
 * nothing the observer can see, and a download or a `_blank` anchor does its work outside
 * this document entirely. Both would be false accusations.
 */
export function isDeadClickExempt(el: UiElement | undefined | null): boolean {
    if (!el) return true;
    if (attr(el, "contenteditable") != null) return true;
    const tag = tagOf(el);
    if (tag === "textarea" || tag === "select") return true;
    if (tag === "input" && !ACTIONABLE_INPUT_TYPES.has((attr(el, "type") ?? "text").trim().toLowerCase())) return true;
    if (tag === "a" && (attr(el, "download") != null || attr(el, "target") === "_blank")) return true;
    return false;
}

/**
 * Rungs 2-5's normalization (§4.6): trim, lowercase, non-alphanumeric → `_`, collapse runs,
 * cap 64. Edge underscores are dropped too, so `"Add to cart!"` is `add_to_cart` and not
 * `add_to_cart_` — a cap or a trailing `!` must not change the name a consumer sees.
 * Returns `""` when nothing survived, which the ladder reads as "this rung had nothing".
 */
export function normalizeUiName(raw: string | null | undefined): string {
    if (!raw) return "";
    return raw
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .slice(0, UI_NAME_MAX)
        .replace(/^_+|_+$/g, "");
}

/** What one click resolved to, before the trace and view snapshot are attached. */
export type UiNameResolution = {
    /** `ui.target` — a derived name, or `unnamed` / `surface` (§4.6). */
    target: string;
    nameSource: UiNameSource;
    /** `ui.tag` — the *resolved* element's tag, lowercased; the click target when none resolved. */
    tag: string;
    /**
     * The node rage identity is keyed on — the resolved element, or the raw target when
     * nothing resolved. **Never the derived name** (§4.6): three clicks on three different
     * `unnamed` divs are indistinguishable on the wire, which is the whole reason rage runs
     * client-side.
     */
    node: unknown;
    /** Whether the click landed on something role-actionable — the `ui.dead` gate. */
    actionable: boolean;
};

/**
 * §4.6's five-rung ladder, gated on element role.
 *
 * Rung 1 (`data-edge-action-name`) is scanned over the **whole** path, works on role-less
 * elements, always wins, and passes through **unnormalized and uncapped** — it is explicit
 * author intent and a consumer must be able to predict the value they just set. Rungs 2-5
 * are read off the nearest role-actionable ancestor *only*, and normalized.
 *
 * @param path `composedPath()`, innermost first.
 * @param pointerCursor whether the click target's computed cursor is `pointer` — the one
 * signal that separates `unnamed` (a real control nobody instrumented) from `surface`.
 */
export function resolveUiName(
    path: readonly UiElement[],
    opts: { pointerCursor?: boolean } = {},
): UiNameResolution {
    const target = path[0];

    for (const el of path) {
        const explicit = attr(el, "data-edge-action-name");
        if (explicit && explicit.trim() !== "") {
            return { target: explicit, nameSource: "edge_action", tag: tagOf(el), node: el, actionable: isActionable(el) };
        }
    }

    const host = path.find(isActionable);
    if (!host) {
        // Role-less. A pointer cursor still says "someone built a control here" (§4.6).
        return {
            target: opts.pointerCursor ? UI_UNNAMED : UI_SURFACE,
            nameSource: "none",
            tag: tagOf(target),
            node: target,
            actionable: false,
        };
    }

    const rungs: Array<[UiNameSource, string | null]> = [
        ["test_id", attr(host, "data-testid")],     // read, never written (§4.6)
        ["aria_label", attr(host, "aria-label")],
        ["title", attr(host, "title")],
        ["text", host.textContent ?? null],
    ];
    for (const [nameSource, raw] of rungs) {
        const name = normalizeUiName(raw);
        if (name) return { target: name, nameSource, tag: tagOf(host), node: host, actionable: true };
    }

    // Actionable but nothing survived: someone should add `data-edge-action-name`.
    return { target: UI_UNNAMED, nameSource: "none", tag: tagOf(host), node: host, actionable: true };
}

/** §4.6's threshold. The window itself is §4.5.2's `QUIET_WINDOW_MS`, passed in by the caller. */
export const RAGE_CLICK_THRESHOLD = 3;

/**
 * ≥3 clicks within a sliding window **on the same live element node**, flagged **once per
 * burst** on the crossing click — so `rage bursts = count of flagged rows` and a fourth and
 * fifth angry click do not each mint their own burst.
 *
 * ⚠ Identity is the node reference the caller hands in, never `ui.target`. The tracker is
 * per-`Telemetry`, so the node references it holds die with the page; it keeps at most
 * `RAGE_CLICK_THRESHOLD` timestamps for one node at a time and drops the node the moment a
 * click lands elsewhere, which is why there is no eviction policy to get wrong.
 */
export class RageTracker {
    private node: unknown;
    private hits: number[] = [];
    private flagged = false;

    constructor(private readonly windowMs: number) {}

    /** @returns `true` on the click that crosses the threshold, and only that one. */
    record(node: unknown, now: number): boolean {
        if (node !== this.node) {
            this.node = node;
            this.hits = [];
            this.flagged = false;
        }
        // Strictly inside the window, matching every other boundary in this SDK.
        this.hits = this.hits.filter(t => now - t < this.windowMs);
        this.hits.push(now);
        if (this.hits.length < RAGE_CLICK_THRESHOLD) {
            // The burst decayed below the threshold — the next crossing is a new burst.
            this.flagged = false;
            return false;
        }
        if (this.flagged) return false;
        this.flagged = true;
        return true;
    }
}

function attr(el: UiElement | undefined | null, name: string): string | null {
    return el?.getAttribute ? el.getAttribute(name) : null;
}

function tagOf(el: UiElement | undefined | null): string {
    return (el?.tagName ?? "").toLowerCase();
}
