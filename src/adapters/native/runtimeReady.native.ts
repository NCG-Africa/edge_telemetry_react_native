// The native half of §4.5.2's `initial_load` seed. `performance.rnStartupTiming` is a
// natively-anchored process-start marker that needs no native module; the bundle-evaluated
// entry is the one §4.3 pins `app.start.js_ready_ms` to, and this reuses it rather than
// inventing a second definition of "the runtime is ready".
//
// ⚠ Absent on the Old Architecture and on runtimes that omit it. Absent resolves to
// `undefined`, which releases the gate — a marker that never arrives must not make every
// launch report `abandoned`.

/** Epoch ms of "bundle evaluated", or undefined where the runtime does not publish it. */
type StartupTiming = { executeJavaScriptBundleEntryPointEnd?: unknown };

function read(): number | undefined {
    // `performance` is a native-only global here and the field is absent on the Old
    // Architecture, so it is read defensively rather than typed as present.
    const perf = (globalThis as { performance?: { rnStartupTiming?: StartupTiming } }).performance;
    const end = perf?.rnStartupTiming?.executeJavaScriptBundleEntryPointEnd;
    return typeof end === "number" && end > 0 ? end : undefined;
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
