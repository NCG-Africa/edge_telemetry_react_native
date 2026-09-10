// The web half of §4.5.2's `initial_load` seed: the launch view is busy until the document's
// own load marker, then settles. `loadEventEnd` is the platform's answer to "the runtime is
// ready"; the SDK does not invent one.
//
// ⚠ Web's `initial_load` is systematically LARGER than native's — it includes DNS, TLS and
// document download where native reads a bundle off local disk. Cross-platform `initial_load`
// comparison is not apples-to-apples (§4.5.2); within-platform release comparison is fine.

/** Epoch ms of `loadEventEnd`, or undefined where the entry is unavailable. */
function readMarker(): number | undefined {
    if (typeof performance === "undefined") return undefined;
    const nav = performance.getEntriesByType?.("navigation")?.[0] as PerformanceNavigationTiming | undefined;
    // Navigation-timing values are relative to timeOrigin; the settle module works in epoch ms.
    if (nav && nav.loadEventEnd > 0) return performance.timeOrigin + nav.loadEventEnd;
    const legacy = (performance as any).timing?.loadEventEnd;   // already epoch ms
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
        window.addEventListener("load", () => {
            // `loadEventEnd` is stamped *after* the load handlers run, so it is still 0 inside
            // one of them. Now is a truthful marker either way — we are in the load event.
            resolve(readMarker() ?? Date.now());
        }, { once: true });
    });
}
