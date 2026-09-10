// The web half of §4.5.2's `initial_load` seed: the launch view is busy until the document's
// own load marker, then settles. `loadEventEnd` is the platform's answer to "the runtime is
// ready"; the SDK does not invent one.
//
// ⚠ Web's `initial_load` is systematically LARGER than native's — it includes DNS, TLS and
// document download where native reads a bundle off local disk. Cross-platform `initial_load`
// comparison is not apples-to-apples (§4.5.2); within-platform release comparison is fine.

import { LOADING_TIME_CAP_MS } from "../loadingTime";

/** Epoch ms of `loadEventEnd`, or undefined where the entry is unavailable. */
function readMarker(): number | undefined {
    if (typeof performance === "undefined") return undefined;
    const nav = performance.getEntriesByType?.("navigation")?.[0] as PerformanceNavigationTiming | undefined;
    // Navigation-timing values are relative to timeOrigin; the settle module works in epoch ms.
    if (nav && nav.loadEventEnd > 0) return performance.timeOrigin + nav.loadEventEnd;
    // `performance.timing` is the removed-but-still-shipped legacy API; not in lib.dom's types.
    const legacy = (performance as unknown as { timing?: { loadEventEnd?: number } }).timing?.loadEventEnd;
    return typeof legacy === "number" && legacy > 0 ? legacy : undefined;
}

/**
 * Resolves once the marker is known — `undefined` when the platform has none to give, which
 * releases the gate rather than leaving every launch reporting `abandoned` (§4.5.2).
 */
export function runtimeReadyAt(): Promise<number | undefined> {
    if (typeof window === "undefined") return Promise.resolve(undefined);

    const early = readMarker();
    if (early !== undefined) return Promise.resolve(early);
    // Already loaded but the entry is missing (an old browser, a same-document navigation):
    // nothing more is coming, so release rather than wait forever.
    if (typeof document !== "undefined" && document.readyState === "complete") {
        return Promise.resolve(undefined);
    }

    return new Promise((resolve) => {
        let settled = false;
        const finish = (at?: number) => { if (!settled) { settled = true; resolve(at); } };

        window.addEventListener("load", () => {
            // `loadEventEnd` is stamped *after* the load handlers run, so it is still 0 inside
            // one of them. Now is a truthful marker either way — we are in the load event.
            finish(readMarker() ?? Date.now());
        }, { once: true });

        // A `load` that never fires — a stalled subresource, a runtime with no such event —
        // would otherwise leave the gate shut forever and make every launch report
        // `abandoned`, which is the exact failure this module exists to avoid. Past the cap
        // the launch view is capped anyway, so there is nothing left to wait for.
        const timer = setTimeout(() => finish(undefined), LOADING_TIME_CAP_MS);
        (timer as any)?.unref?.();   // never hold a Node process open for a marker
    });
}
