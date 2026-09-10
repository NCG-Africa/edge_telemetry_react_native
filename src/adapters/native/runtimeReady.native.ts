// The native half of §4.5.2's `initial_load` seed. `performance.rnStartupTiming` is a
// natively-anchored process-start marker that needs no native module; the bundle-evaluated
// entry is the one §4.3 pins `app.start.js_ready_ms` to, and this reuses it rather than
// inventing a second definition of "the runtime is ready".
//
// ⚠ Absent on the Old Architecture and on runtimes that omit it. Absent resolves to
// `undefined`, which releases the gate — a marker that never arrives must not make every
// launch report `abandoned`.

/** Epoch ms of "bundle evaluated", or undefined where the runtime does not publish it. */
export function runtimeReadyAt(): Promise<number | undefined> {
    const timing = (globalThis as any).performance?.rnStartupTiming;
    const end = timing?.executeJavaScriptBundleEntryPointEnd;
    return Promise.resolve(typeof end === "number" && end > 0 ? end : undefined);
}
