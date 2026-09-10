// Arming §4.5.2's `initial_load` seed, shared by both entries because only the *source* of the
// marker is platform-specific — the failure handling around it is not, and it is the part that
// must not be got wrong twice.
//
// Every path here ends in exactly one `seedRuntimeReady()` call. A gate that is never released
// makes every launch report `abandoned`, which is the one outcome this seed exists to prevent.

import { debug } from "../core/debug";
import type { ViewManager } from "./viewManager";

export type RuntimeReadyReader = () => Promise<number | undefined>;

/**
 * Fire-and-forget on purpose: on web the marker arrives with the load event, and blocking init
 * on it would put every host call behind the page's own images. The caller awaits the *module*
 * import instead, so the seed is armed before the instance is visible.
 */
export function seedRuntimeReady(views: ViewManager, read: RuntimeReadyReader, build: string): void {
    // `Promise.resolve().then` and not a bare call: a reader that throws *synchronously* would
    // sidestep the catch below and leave the gate shut.
    void Promise.resolve()
        .then(read)
        .then((at) => views.seedRuntimeReady(at))
        .catch((err: unknown) => {
            debug.warn(`${build} runtime-ready marker unavailable:`, err);
            views.seedRuntimeReady(undefined);   // release the gate anyway
        });
}
