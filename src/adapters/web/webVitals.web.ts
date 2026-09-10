// §5.3 / #106 — the five Core Web Vitals, **web only**, on the **metric** path. An event named
// `LCP` would land its name in the performance-events table and lose its number; the metric
// path promotes `value` and `unit` for free.
//
// `web-vitals/attribution` is a bundled web-only dependency, imported from this `.web.ts` file
// and nowhere else — that is what keeps it out of `index.native` entirely and means consumers
// install nothing. Hand-rolling was rejected on session-windowed CLS (the naive sum is wrong
// *and plausible*) and percentile INP.

import { vitalAttributes, type VitalMetric } from "../webVitals";
import type { ViewLoadType } from "../viewManager";

/**
 * All this tracker needs of core. Structural, so it is testable without a `Telemetry`.
 */
type VitalsEmitter = {
    logMetric(name: string, value: number, data?: Record<string, any>): unknown;
    views: { onBoundary(fn: (successorLoadType: ViewLoadType) => unknown): () => void };
};

export class WebVitalsTracker {
    /** The running values, held rather than emitted — see `start()`. */
    private held = new Map<string, VitalMetric>();
    /** What each held name last shipped, so an unchanged value does not re-ship at every hide. */
    private emitted = new Map<string, number>();
    private started = false;

    constructor(private telemetry: VitalsEmitter) { }

    /**
     * Idempotent: a second call must not double-subscribe and double every vital row.
     *
     * LCP, FCP and TTFB fire once on the initial load, so they emit straight from the callback.
     *
     * ⚠ **CLS and INP subscribe with `reportAllChanges: true` as a running-value subscription,
     * not an emission trigger.** The latest value is held in memory and shipped at the
     * `ViewManager`'s background boundary — the library's default page-hide report loses both
     * on a closed tab, because that report races the document's own teardown.
     *
     * ⚠ **All five are page-load-scoped, not view-scoped.** `LCP`, `FCP` and `TTFB` physically
     * cannot recur on a soft navigation, so `view.id` on a vital row is always the *initial*
     * view's. It is a real join key, it is just not "the view this happened in" for CLS and INP:
     * `GROUP BY view.name` over vitals reads **"by entry point"**. Documented, not engineered
     * around — view-scoping would need the Chrome-only Soft Navigations API.
     */
    async start(): Promise<void> {
        if (this.started) return;
        this.started = true;

        const { onLCP, onFCP, onTTFB, onCLS, onINP } = await import("web-vitals/attribution");

        onLCP(m => void this.emit(m));
        onFCP(m => void this.emit(m));
        onTTFB(m => void this.emit(m));

        const hold = (m: VitalMetric) => { this.held.set(m.name, m); };
        onCLS(hold, { reportAllChanges: true });
        onINP(hold, { reportAllChanges: true });

        // `"resume"` is the background boundary's successor load type. A route change fires
        // here too and is deliberately ignored: these are page-load-scoped values.
        this.telemetry.views.onBoundary(lt => (lt === "resume" ? this.drain() : undefined));
    }

    /**
     * Awaited inside `beginView` while the departing view is still current, so the rows carry
     * the view they were accumulated under. A name whose running value has not moved since its
     * last row is skipped — a tab hidden twice with no shifts in between is not two CLS
     * samples, and the library's own report has the same no-delta-no-report property.
     *
     * Keying on `value` alone is exact for both held vitals, not a shortcut: CLS is cumulative,
     * so *any* shift moves it, and INP only changes when a worse interaction happens. An
     * unchanged value therefore means the attribution is unchanged too.
     */
    private async drain(): Promise<void> {
        for (const [name, m] of this.held) {
            if (this.emitted.get(name) === m.value) continue;
            this.emitted.set(name, m.value);
            await this.emit(m);
        }
    }

    private emit(m: VitalMetric): unknown {
        // `metric.unit` is stamped by core's METRIC_UNIT map — `ms` for four of them and
        // **`score` for CLS**, without which a 0.08 renders as a flat zero line beside an
        // LCP of 4000 in the same `value` column.
        return this.telemetry.logMetric(m.name, m.value, vitalAttributes(m));
    }
}
