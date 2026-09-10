// `view.loading_time` — network settle, one definition, both builds (§4.5.2, #97).
//
// Scoped to exactly one job: p75 route-change responsiveness by `view.name`, compared across
// releases. That framing licenses a crude stable heuristic over a clever one, and makes a
// **null strictly better than a plausible guess** — a wrong-but-believable 300 ms poisons a
// release comparison silently, and a `0` makes p75 track the cache-hit rate, so a backend
// caching win renders as a frontend regression, reversed.
//
// Network-only, because in-flight fetch/XHR is the one settle signal both builds genuinely
// have. DOM-mutation quiet is meaningless under React's routine re-rendering; rAF quiet never
// settles against RN's animation driver. So this module is shared and neither build gets its
// own definition of the same column.

/**
 * The quiet window, and **the same constant as §4.6's dead-click window** — one constant, not
 * two. `ui.dead` (web only, not built yet) must import this rather than declare a second 1000.
 */
export const QUIET_WINDOW_MS = 1000;

/** Hard cap (§4.5.2). A capped view emits **null, not the cap**: at 30 s, 30 s and 90 s are the same row. */
export const LOADING_TIME_CAP_MS = 30_000;

/** §4.5's `view.loading_time_outcome` domain — never null, exactly four values. */
export type LoadingTimeOutcome = "settled" | "no_activity" | "capped" | "abandoned";

export type LoadingTimeResult = {
    /** Milliseconds, or null — and null has three causes, which is why the outcome ships beside it. */
    loadingTime: number | null;
    outcome: LoadingTimeOutcome;
};

export type NetworkSettleOpts = {
    /**
     * `initial_load` only: the view starts **busy** until the platform's own runtime-ready
     * marker (`loadEventEnd` on web, `performance.rnStartupTiming` on native), then settles.
     * Every other `load_type` runs the same column with no seed.
     */
    awaitRuntimeReady?: boolean;
};

/**
 * One view's settle state. Constructed per view and handed the requests that **started** in
 * it — a request in flight across a view boundary belongs to the old view and does not hold
 * the new one open (§4.5.2), which is why the completion callback is bound to this instance
 * rather than looked up on whatever view is live when the response lands.
 */
export class NetworkSettle {
    private started = 0;
    private inFlight = 0;
    private lastEnd?: number;
    /** Frozen the first time quiet is *observed*, so a later request cannot un-settle the view. */
    private settledAt?: number;
    private awaitingRuntimeReady: boolean;
    private runtimeReadyAt?: number;

    constructor(private readonly viewStart: number, opts?: NetworkSettleOpts) {
        this.awaitingRuntimeReady = opts?.awaitRuntimeReady ?? false;
    }

    /** `view.request_count` — requests **started** in this view, failures included (§4.5). */
    get requestCount(): number {
        return this.started;
    }

    /**
     * The platform's runtime-ready marker, or `undefined` where the platform has none —
     * Old Architecture, or a runtime that omits it (§4.3). Either way this releases the gate:
     * a marker that never arrives must not make every launch report `abandoned`.
     */
    seedRuntimeReady(at?: number): void {
        // A successor was never gated on the marker, and on web the `load` event routinely
        // arrives *after* the first route change — flooring that view's settle at the page's
        // load time would inflate a route-change measurement with the launch's cost.
        if (!this.awaitingRuntimeReady) return;
        this.awaitingRuntimeReady = false;
        this.runtimeReadyAt = at;
    }

    /**
     * A request started in this view. Returns its completion callback — idempotent, because an
     * XHR `loadend` can fire more than once for a reused instance and an unbalanced in-flight
     * count would hold the view open forever.
     */
    requestStarted(now: number = Date.now()): (endedAt?: number) => void {
        this.started++;
        this.freezeIfQuiet(now);
        // Already settled: it counts toward `request_count` but must not re-arm the view, or a
        // 30-second poller keeps one screen "loading" for as long as the user stays on it.
        if (this.settledAt !== undefined) return () => { };

        this.inFlight++;
        let done = false;
        return (endedAt: number = Date.now()) => {
            if (done) return;
            done = true;
            this.inFlight--;
            if (this.lastEnd === undefined || endedAt > this.lastEnd) this.lastEnd = endedAt;
        };
    }

    /**
     * The view's verdict at exit. Idempotent, not pure: it may freeze the settle timestamp as
     * a side effect, which is deliberate — once quiet has been *observed* it cannot be undone
     * by a later call, and calling this twice must not produce two different answers.
     */
    resolve(now: number = Date.now()): LoadingTimeResult {
        // The contract's free invariant, and the branch that establishes it: `no_activity` ⇔
        // `view.request_count = 0`. It is checked before the runtime-ready seed on purpose —
        // the seed is a *floor* on when settle may happen, not a source of activity, so a
        // launch that fetched nothing has no loading time to report rather than one measuring
        // the platform's own startup.
        if (this.started === 0) return { loadingTime: null, outcome: "no_activity" };

        this.freezeIfQuiet(now);
        // The view is exiting, so no further request can *start* in it — quiet is confirmed by
        // construction and the rest of the window is pure detection delay, which §4.5.2 says is
        // free. Charging it as `abandoned` would drop the fastest views out of the `settled`
        // population and bias the p75 this column exists to serve, in the wrong direction.
        // `abandoned` is left meaning what it says: the user left while it was still loading.
        const settledAt = this.settledAt ?? this.quietSince();
        if (settledAt === undefined) {
            // Capped and abandoned are different populations, read as different series, and
            // must not be merged.
            return {
                loadingTime: null,
                outcome: now - this.viewStart >= LOADING_TIME_CAP_MS ? "capped" : "abandoned",
            };
        }

        const settleAt = Math.max(settledAt, this.runtimeReadyAt ?? 0);
        const value = settleAt - this.viewStart;
        if (value >= LOADING_TIME_CAP_MS) return { loadingTime: null, outcome: "capped" };
        return { loadingTime: Math.max(0, value), outcome: "settled" };
    }

    /**
     * Settle is the *completion* timestamp, not the moment we noticed it — the quiet window is
     * detection delay and is subtracted back out. That is free precisely because the `view`
     * event emits at view exit rather than at settle, so nothing waits on the window.
     */
    private freezeIfQuiet(now: number): void {
        if (this.settledAt !== undefined) return;
        const quiet = this.quietSince();
        if (quiet !== undefined && now - quiet >= QUIET_WINDOW_MS) this.settledAt = quiet;
    }

    /** When the network last went quiet, or undefined while the view is still busy. */
    private quietSince(): number | undefined {
        if (this.awaitingRuntimeReady) return undefined;   // initial_load is busy until the marker
        if (this.inFlight > 0) return undefined;
        return this.lastEnd;
    }
}
