// The native half of §4.5.2's `initial_load` seed. `performance.rnStartupTiming` is a
// natively-anchored process-start marker that needs no native module; the bundle-evaluated
// entry is the one §4.3 pins `app.start.js_ready_ms` to, and this reuses it rather than
// inventing a second definition of "the runtime is ready".
//
// ⚠ Absent on the Old Architecture and on runtimes that omit it. Absent resolves to
// `undefined`, which releases the gate — a marker that never arrives must not make every
// launch report `abandoned`.

type StartupTiming = { startTime?: unknown; executeJavaScriptBundleEntryPointEnd?: unknown };
type Perf = { now?: () => number; rnStartupTiming?: StartupTiming };

/**
 * The markers are stamped on the native monotonic clock — iOS `CACurrentMediaTime()`, Android
 * `SystemClock.uptimeMillis()` — the same clock `performance.now()` reads, not epoch. Shifted
 * onto `Date.now()`'s timeline here so every caller can compare them with wall time.
 * ponytail: a value already past 1e12 is taken as epoch (31 years of uptime is not a device).
 */
export function toEpoch(t: unknown): number | undefined {
    if (typeof t !== "number" || !(t > 0)) return undefined;
    if (t > 1e12) return t;
    const now = (globalThis as { performance?: Perf }).performance?.now?.();
    return typeof now === "number" ? Date.now() - now + t : undefined;
}

/** Epoch ms of process start (#171's initial-view anchor), or undefined where unpublished. */
export function processStartAt(): number | undefined {
    return toEpoch((globalThis as { performance?: Perf }).performance?.rnStartupTiming?.startTime);
}

function read(): number | undefined {
    // `performance` is a native-only global here and the field is absent on the Old
    // Architecture, so it is read defensively rather than typed as present.
    return toEpoch((globalThis as { performance?: Perf }).performance?.rnStartupTiming?.executeJavaScriptBundleEntryPointEnd);
}

export async function runtimeReadyAt(): Promise<number | undefined> {
    const early = read();
    if (early !== undefined) return early;

    // `executeJavaScriptBundleEntryPointEnd` is stamped only once the bundle entry point has
    // finished, and the common wiring constructs the SDK at module scope — i.e. inside that
    // entry point, before the field exists. One turn of the event loop is after it by
    // construction, so re-read once rather than reporting "no marker" to every real app.
    await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 0);
        (timer as { unref?: () => void })?.unref?.();
    });
    return read();
}
