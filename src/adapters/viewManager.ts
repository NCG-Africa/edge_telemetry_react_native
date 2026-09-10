// The View entity (§4.5, #96) — shared by both builds, because everything in it is
// platform-agnostic bookkeeping. It owns three things:
//
//   1. `view.id` + `view.name`, denormalized onto the Context block of every event and
//      metric, so "errors by screen" and "p95 by screen" need no join.
//   2. the `view` event emitted at exit, carrying dwell, the three counters and the
//      network-settle verdict from `loadingTime.ts` (#97).
//   3. the name ladder, and the four lifetime boundaries.
//
// It never imports a platform API. The entries feed it: route changes via
// `Telemetry.recordRouteChange`, background via `AppLifecycleEmitter`, session rotation
// via `Telemetry.newSession`. Process death needs no feed — a new process opens a fresh
// initial view, and the killed view's dwell is lost by design (no `view` event was emitted).

import { randomHex } from "../core/utils/uuid";
import { NetworkSettle } from "./loadingTime";

/** §4.5.1's ladder. `none` is the literal `"unknown"` name, not an absent one. */
export type ViewNameSource = "explicit" | "route" | "url" | "none";
/** §4.5's four `view.load_type` values — one per lifetime boundary that mints a successor. */
export type ViewLoadType = "initial_load" | "route_change" | "resume" | "session_rotation";

/** Rank beats order (§4.5.1): explicit > route > url > none. */
const RANK: Record<ViewNameSource, number> = { none: 0, url: 1, route: 2, explicit: 3 };

/** `view.name` before anything has named the view. A literal, never null (§4.5.1). */
export const UNKNOWN_VIEW_NAME = "unknown";

/**
 * All ViewManager needs of core. Structural, so the manager stays unit-testable alone.
 * `trace` is optional for that reason and for that reason only — every real `Telemetry`
 * has one, and a view with no trace source simply carries no §6 keys.
 */
type Emitter = {
    log(name: string, data?: Record<string, any>): unknown;
    trace?: { viewSpan(entryAt: number): Record<string, string | number> };
};

type View = {
    id: string;
    name: string;
    source: ViewNameSource;
    referrer: string;
    loadType: ViewLoadType;
    // Dwell is foreground-only (§4.5), so it banks on background and re-arms on foreground
    // rather than running off a single start timestamp.
    elapsed: number;
    resumedAt?: number;    // undefined = the clock is paused (app backgrounded)
    errors: number;
    actions: number;
    // `view.request_count` and `view.loading_time` both live here — both count requests
    // *started* in this view, so one object owns both and they cannot disagree (§4.5.2).
    settle: NetworkSettle;
    // §6.3's Tier 1 keys, captured at view **entry**: a `view` row parents to the root that
    // was live when the screen opened, not the one live when the user left it. Held here
    // rather than read at exit precisely so the later root cannot claim it.
    span: Record<string, string | number>;
};

/** `view_{ms}_{16hex}` (§3.3). No platform suffix — a view never leaves its process. */
function mintViewId(): string {
    return `view_${Date.now()}_${randomHex(16)}`;
}

export class ViewManager {
    private view: View;
    /** Origin only, and only where there is one — omitted on native (§4.5). */
    private readonly host?: string;

    constructor(private telemetry: Emitter) {
        // A capability check, not a platform branch: RN has no `location`, and a
        // white-label web bundle serving two banks needs the origin to tell them apart.
        this.host = typeof location !== "undefined" && location?.origin ? location.origin : undefined;
        // The initial view opens at SDK init, so `view.id` is never absent (§4.5).
        const now = Date.now();
        this.view = {
            id: mintViewId(), name: UNKNOWN_VIEW_NAME, source: "none",
            referrer: "", loadType: "initial_load",
            elapsed: 0, resumedAt: now, errors: 0, actions: 0,
            // The launch view is the one `load_type` that seeds from the platform's
            // runtime-ready marker: it is busy until the bundle has evaluated (§4.5.2).
            settle: new NetworkSettle(now, { awaitRuntimeReady: true }),
            // The launch root is live here — it is minted in the same `Telemetry` constructor,
            // just above this one — so the initial view is its child and a web hard load
            // reports `launch`, never `navigation` (§6.2).
            span: telemetry.trace?.viewSpan(now) ?? {},
        };
    }

    /** The two keys the Context block carries on every row. Name resolves at log time. */
    get id(): string { return this.view.id; }
    get name(): string { return this.view.name; }

    /**
     * The name ladder (§4.5.1), and the only path that mints a view from a *name*.
     *
     * - a **higher** rung re-stamps the name and never changes `view.id` — that is what
     *   "rank beats order" means, and it is why a route name arriving after a URL-derived
     *   one upgrades the view in place instead of splitting it in two;
     * - a **lower** rung is ignored outright, whenever it arrives — ⚠ *including its
     *   boundary*. A host that mixes rung 1 with `attachNavigation` therefore pins the view
     *   to the `screenStart` name until the next `screenStart`: route changes stop minting
     *   successors, and dwell keeps accruing under the explicit name. That is what §4.5.1's
     *   "a lower rung arriving later does not overwrite a higher one" costs, and the two
     *   rungs describing one navigation (the upgrade window) is the case it exists for.
     *   It needs a contract ruling, not a local invention — see CLAUDE.md's known gaps;
     * - the **same** rung naming a different screen is a genuine navigation, so it ends the
     *   view and mints a successor.
     *
     * Rungs 1 and 2 are handed through unnormalized: a host naming a screen "Step 2 of 3"
     * must not receive "Step {id} of {id}". The caller normalizes rung 3, not this method.
     */
    async navigate(name: string, source: ViewNameSource): Promise<void> {
        const rank = RANK[source], current = RANK[this.view.source];
        if (rank < current) return;
        if (rank > current) { this.view.name = name; this.view.source = source; return; }
        if (name === this.view.name) return;
        await this.exit("route_change", name, source);
    }

    /** `view.error_count` — `app.crash` rows sharing this `view.id`. A closed enumeration. */
    countError(): void { this.view.errors++; }

    /** `view.action_count` — interaction rows sharing this `view.id`. */
    countAction(): void { this.view.actions++; }

    /**
     * An HTTP request started (§4.5.2). Returns its completion callback, **bound to the view
     * that was live at start** — a request that finishes after a route change belongs to the
     * view it started in and does not hold the arriving one open. The collector's own POST
     * never reaches here; the interceptors filter it before calling.
     */
    requestStarted(now?: number): (endedAt?: number) => void {
        return this.view.settle.requestStarted(now);
    }

    /**
     * The platform's runtime-ready marker — `loadEventEnd` on web,
     * `performance.rnStartupTiming` on native — or `undefined` where the platform has none.
     *
     * Forwarded to whatever view is current, which is safe because a view that was never gated
     * *ignores* the seed — enforced in `NetworkSettle`, not assumed here. On web the `load`
     * event routinely arrives after the first route change, and flooring that view's settle at
     * the page's load time would charge the launch's cost to a route change.
     */
    seedRuntimeReady(at?: number): void {
        this.view.settle.seedRuntimeReady(at);
    }

    /**
     * Emit the `view` event for the current view. Its `view.name` is authoritative and its
     * `view.name_source` reports the *final* rung; the Context-block copy on rows emitted
     * early in the view may still carry a lower rung's name (§4.5.1).
     *
     * `view.loading_time` is **omitted when null**, following this contract's general
     * absent-means-the-SDK-had-nothing discipline (§4.11 names `navigation.from_screen` as the
     * only explicit wire null). `view.loading_time_outcome` always ships: it is what tells the
     * three null causes apart, and reading p75-of-settled beside %-capped is the whole point.
     */
    async endView(): Promise<void> {
        const v = this.view;
        const { loadingTime, outcome } = v.settle.resolve();
        await this.telemetry.log("view", {
            // A **point span** (§6.3): `span.start_time` from view entry and never
            // `span.duration_ms`. View dwell is `view.time_spent`, not span width — a width
            // here would stretch every tap-that-navigates envelope across the whole visit.
            ...v.span,
            ...(this.host ? { "view.host": this.host } : {}),
            "view.referrer": v.referrer,
            "view.load_type": v.loadType,
            "view.name_source": v.source,
            "view.time_spent": this.timeSpent(),
            ...(loadingTime === null ? {} : { "view.loading_time": loadingTime }),
            "view.loading_time_outcome": outcome,
            "view.error_count": v.errors,
            "view.action_count": v.actions,
            "view.request_count": v.settle.requestCount,
        });
    }

    /**
     * Mint the successor. Called directly by session rotation, which has to mint *after*
     * the new `session.id` is in place — `view.id` never spans a `session.id` (§4.5).
     * An unnamed successor carries the departing view's name: backgrounding and a session
     * rotation do not move the user off the screen they were on.
     */
    beginView(successorLoadType: ViewLoadType, name?: string, source?: ViewNameSource): void {
        const prev = this.view;
        const now = Date.now();
        this.view = {
            id: mintViewId(),
            name: name ?? prev.name,
            source: source ?? prev.source,
            referrer: prev.name,
            loadType: successorLoadType,
            elapsed: 0, resumedAt: now, errors: 0, actions: 0,
            // No runtime-ready seed: only `initial_load` has a platform marker to wait on.
            settle: new NetworkSettle(now),
            // A view start *extends* the live root; with none live it mints a `navigation`
            // one (§6.2). Its exit does not extend anything (§6.7).
            span: this.telemetry.trace?.viewSpan(now) ?? {},
        };
    }

    /** A boundary that stays inside one session: emit, then mint the successor. */
    async exit(successorLoadType: ViewLoadType, name?: string, source?: ViewNameSource): Promise<void> {
        await this.endView();
        this.beginView(successorLoadType, name, source);
    }

    /**
     * The background boundary. The successor is minted immediately — `view.id` must never
     * be absent — but its clock starts paused, so a night spent backgrounded does not land
     * as dwell on whatever screen the user left open.
     */
    async background(): Promise<void> {
        await this.exit("resume");
        const v = this.view;
        v.elapsed += this.sinceResume();
        v.resumedAt = undefined;
    }

    /** The matching foreground edge: re-arm the paused clock. */
    foreground(): void {
        this.view.resumedAt ??= Date.now();
    }

    private sinceResume(): number {
        return this.view.resumedAt === undefined ? 0 : Date.now() - this.view.resumedAt;
    }

    private timeSpent(): number {
        return Math.max(0, this.view.elapsed + this.sinceResume());
    }
}
