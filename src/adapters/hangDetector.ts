// `app.hang` (#165, decision #143) — one JS-thread stall detector, shared by both builds:
// a self-rescheduling timer that measures how late it fired. Nothing here is platform
// specific — `setTimeout` and `performance.now()` are globals both runtimes provide.

import { debug } from "../core/debug";
import type { LogSnapshot } from "../core/telemetry";
import type { TraceAttributes } from "./traceManager";

/** Internal constants, never `TelemetryOpts` surface. */
export const HANG_TICK_MS = 1000;
export const HANG_THRESHOLD_MS = 2000;
/** Longer than this is a suspension (device sleep, a frozen tab), not a hang the user sat through. */
export const HANG_SUSPENSION_MS = 60000;

/**
 * The stall between two ticks, or `undefined` when there is none to report: how late the
 * timer fired past its schedule, so the tick interval itself is never booked as stall.
 * ⚠ At 1 s resolution this under-reports by up to one tick — a stall that began mid-interval
 * is partly absorbed by the wait the timer would have done anyway. Never over-reports.
 */
export function stallMs(prevTick: number, now: number): number | undefined {
    const late = now - prevTick - HANG_TICK_MS;
    return late >= HANG_THRESHOLD_MS && late <= HANG_SUSPENSION_MS ? Math.round(late) : undefined;
}

type Core = {
    snapshot(at?: number): LogSnapshot;
    trace: { annotate(now?: number): TraceAttributes };
    log(name: string, data?: Record<string, any>, snapshot?: LogSnapshot): Promise<void>;
};

export class HangDetector {
    private timer?: ReturnType<typeof setTimeout>;
    /** The last good tick — what a stall is attributed to: where the user was when it froze. */
    private last?: { mono: number; snap: LogSnapshot; trace: TraceAttributes };

    constructor(private core: Core, private now: () => number = () => performance.now()) {}

    private active = false;
    private suspended = false;

    /** Driven by the lifecycle emitter: foreground only, so background suspension never reads as a hang. */
    setActive(active: boolean) {
        this.active = active;
        this.sync();
    }

    /** `disable()` / `enable()` (#172): off while collection is off, whatever the lifecycle says. */
    suspend(suspended: boolean) {
        this.suspended = suspended;
        this.sync();
    }

    private sync() {
        if (this.active && !this.suspended) this.start();
        else this.stop();
    }

    start() {
        if (this.timer === undefined) this.tick();
    }

    /** Idempotent. `shutdown()` and backgrounding call it; the next start begins a fresh baseline. */
    stop() {
        if (this.timer !== undefined) clearTimeout(this.timer);
        this.timer = undefined;
        this.last = undefined;
    }

    private tick = () => {
        const mono = this.now();
        const prev = this.last;
        const stall = prev && stallMs(prev.mono, mono);
        if (prev && stall !== undefined) {
            // Tier 2 from the last good tick's live root — read then, never minted (§6.3).
            // No stack: the frozen code has already returned by the time anything can look.
            this.core.log("app.hang", { ...prev.trace, "hang.duration_ms": stall }, prev.snap)
                .catch((err) => debug.warn("app.hang failed:", err));
        }
        const at = Date.now();
        this.last = { mono, snap: this.core.snapshot(at), trace: this.core.trace.annotate(at) };
        this.timer = setTimeout(this.tick, HANG_TICK_MS);
    };
}
