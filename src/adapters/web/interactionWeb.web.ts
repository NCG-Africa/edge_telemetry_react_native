// `ui.interaction` on web (§4.6, #102) — one capture-phase `click` listener on `document`,
// the role-gated name ladder from `../uiInteraction`, and the two frustration signals.
//
// **Every click emits, actionable or not.** Suppressing the role-less ones would destroy
// dead-click detection at the source, and it is what makes `unnamed` vs `surface` readable
// as "an instrumentation gap" vs "someone tapped whitespace".

import type { LogSnapshot, Telemetry } from "../../core/telemetry";
import { debug } from "../../core/debug";
import { QUIET_WINDOW_MS } from "../loadingTime";
import {
    RAGE_WINDOW_MS,
    RageTracker,
    isDeadClickExempt,
    resolveUiName,
    type UiElement,
} from "../uiInteraction";

/**
 * ⚠ The dead-click window **is** §4.5.2's quiet window — one named constant, not a second
 * literal `1000`. If one moves, both move. (`RAGE_WINDOW_MS` is deliberately *not* bound to
 * it: §4.6 states the same number for rage, but tuning network settle must not retune rage.)
 */
const DEAD_CLICK_WINDOW_MS = QUIET_WINDOW_MS;

/** One click whose dead-click window is still open. */
type Pending = {
    attrs: Record<string, any>;
    snapshot: LogSnapshot;
    /** The aliveness reading at mint; unchanged when the window closes means dead. */
    tick: number;
    timer: ReturnType<typeof setTimeout>;
};

export class InteractionTrackerWeb {
    private started = false;
    private readonly rage = new RageTracker(RAGE_WINDOW_MS);

    /**
     * Monotonic aliveness counter. A DOM mutation, a request start or a view mint bumps it;
     * a click that sees the same value a window later saw nothing happen. A counter rather
     * than a timestamp so the comparison needs no clock and cannot be fooled by a clock that
     * moved backwards.
     */
    private aliveTick = 0;
    private readonly pending = new Set<Pending>();
    private observer?: MutationObserver;

    constructor(private telemetry: Telemetry) {}

    start(): void {
        if (this.started) return;
        if (typeof document === "undefined" || !document?.addEventListener) {
            debug.log("Web interactions: no document — ui.interaction is not captured");
            return;
        }
        this.started = true;
        // Capture phase: the mint has to happen before the host's own handler navigates,
        // because the snapshot it takes is the whole point of §4.6's mint/emit split.
        document.addEventListener("click", (e) => this.onClick(e), true);

        // A same-tab `<a href>` or a form submit unloads the document while its dead-click
        // window is still open, and an unemitted row also orphans the interaction root its
        // children already joined. Both edges drain what is pending — `pagehide` covers the
        // unload and the bfcache freeze, `visibilitychange` covers a tab switch and is the
        // edge mobile Safari actually fires.
        if (typeof window !== "undefined") {
            window.addEventListener?.("pagehide", () => this.drainPending());
        }
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "hidden") this.drainPending();
        });

        this.telemetry.views.onActivity(() => { this.aliveTick++; });
    }

    private onClick(e: Event): void {
        const at = Date.now();
        const path = pathOf(e);
        const resolution = resolveUiName(path, { pointerCursor: hasPointerCursor(path[0]) });

        // Snapshotted here, synchronously, while the click's own view is still current.
        const snapshot = this.telemetry.snapshot(at);
        // §6.2: **every** click mints an interaction root, live carrier or not.
        const span = this.telemetry.trace.interactionSpan(at);
        const mouse = e as MouseEvent;

        const attrs: Record<string, any> = {
            ...span,
            "ui.type": "click",
            "ui.target": resolution.target,
            "ui.name_source": resolution.nameSource,
            "ui.tag": resolution.tag,
            // Viewport pixels. `clientX/Y` is absent on a synthetic or keyboard-driven click,
            // and §4.6 types both as never-null, so there is no honest way to omit them.
            "ui.x": Math.round(mouse.clientX ?? 0),
            "ui.y": Math.round(mouse.clientY ?? 0),
            // Absent means false, deliberately asymmetric with `ui.dead` (§4.6).
            ...(this.rage.record(resolution.node, at) ? { "ui.rage": true } : {}),
        };

        // `ui.dead` is judged on **actionable** clicks only, minus text entry and
        // download/`_blank` anchors — and is **omitted when not evaluated**. That absence is
        // load-bearing: the signal must under-report rather than falsely accuse.
        if (resolution.actionable && !isDeadClickExempt(path[0]) && this.canObserve()) {
            this.watchForDeath(attrs, snapshot);
        } else {
            this.emit(attrs, snapshot);
        }
    }

    /** Arm one dead-click window and emit when it closes. */
    private watchForDeath(attrs: Record<string, any>, snapshot: LogSnapshot): void {
        const entry: Pending = {
            attrs,
            snapshot,
            tick: this.aliveTick,
            timer: setTimeout(() => {
                this.pending.delete(entry);
                if (this.pending.size === 0) this.disconnectObserver();
                this.emit({ ...attrs, "ui.dead": this.aliveTick === entry.tick }, snapshot);
            }, DEAD_CLICK_WINDOW_MS),
        };
        this.pending.add(entry);
        this.connectObserver();
    }

    /**
     * Emit every open window **now**, with `ui.dead` **omitted** — the window never closed,
     * so it was not evaluated, which is exactly what its absence means (§4.6). Inventing a
     * verdict from a partial window is the false accusation the key is built to avoid.
     */
    private drainPending(): void {
        for (const entry of this.pending) {
            clearTimeout(entry.timer);
            this.emit(entry.attrs, entry.snapshot);
        }
        this.pending.clear();
        this.disconnectObserver();
    }

    private emit(attrs: Record<string, any>, snapshot: LogSnapshot): void {
        void Promise.resolve(this.telemetry.log("ui.interaction", attrs, snapshot))
            .catch((err: unknown) => debug.warn("Web ui.interaction failed:", err));
    }

    private canObserve(): boolean {
        return typeof MutationObserver !== "undefined";
    }

    /**
     * Observed only while a window is open. A permanently-connected whole-document observer
     * is a real cost on a busy React tree, and there is nothing to answer between clicks.
     * `attributes: true` because §4.6 counts an attribute-only change as alive — a CSS class
     * flip is a response.
     */
    private connectObserver(): void {
        const root = typeof document === "undefined" ? undefined : document.documentElement;
        if (this.observer || !this.canObserve() || !root) return;
        this.observer = new MutationObserver(() => { this.aliveTick++; });
        this.observer.observe(root, {
            subtree: true,
            childList: true,
            attributes: true,
            characterData: true,
        });
    }

    private disconnectObserver(): void {
        this.observer?.disconnect();
        this.observer = undefined;
    }
}

/**
 * `composedPath()` innermost-first, so a click inside a shadow root still finds its host's
 * role. Falls back to the parent chain where the event has no `composedPath` (older
 * browsers, and every synthetic event a test hands in).
 */
function pathOf(e: Event): UiElement[] {
    const composed = typeof e.composedPath === "function" ? e.composedPath() : undefined;
    if (Array.isArray(composed) && composed.length > 0) return composed as unknown as UiElement[];
    const path: UiElement[] = [];
    let node = e.target as (Node & UiElement) | null;
    while (node) {
        path.push(node);
        node = ((node as any).parentElement ?? node.parentNode) as (Node & UiElement) | null;
    }
    return path;
}

/**
 * The one signal separating `unnamed` from `surface` on a role-less element. Wrapped
 * because `getComputedStyle` throws on a detached node in some engines, and a click must
 * never be lost to a style read.
 */
function hasPointerCursor(el: UiElement | undefined): boolean {
    if (!el || typeof getComputedStyle === "undefined") return false;
    try {
        return getComputedStyle(el as unknown as Element)?.cursor === "pointer";
    } catch {
        return false;
    }
}
