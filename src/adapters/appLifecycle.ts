import { Telemetry } from "../core/telemetry";

/**
 * Shared foreground/background emitter — the single source of truth so the native
 * (RN AppState) and web (visibilitychange) lifecycle adapters stay in lockstep on the
 * v3 `app_lifecycle` contract (#30).
 *
 * Feed it the current active state via `onState(isActive)`. It emits `app_lifecycle` only
 * on a transition, carrying the direction as `app_lifecycle.state` (foreground|background).
 */
export class AppLifecycleEmitter {
  private active?: boolean;

  constructor(private telemetry: Telemetry) {}

  /**
   * Returns once the transition's rows are enqueued — **await it before flushing**. The
   * background boundary's `view` row is the one most likely to be lost to an OS kill, and
   * the whole point of §4.5's background boundary is that it flushes while the app is still
   * reliably alive. A caller that fires the flush on the next line instead sends the batch
   * before the row exists.
   */
  async onState(isActive: boolean): Promise<void> {
    const previous = this.active;
    this.active = isActive;
    if (previous === undefined || previous === isActive) return;

    // Chained, not fired alongside, so the `app_lifecycle` row lands in the view it happened
    // in — awaited because a consumer-supplied double may return a plain value.
    await this.telemetry.log("app_lifecycle", {
      "app_lifecycle.state": isActive ? "foreground" : "background",
    });
    // The view ends and emits, and the successor's clock starts paused so a night spent
    // backgrounded is not charged as dwell to the screen the user left open.
    if (isActive) this.telemetry.views.foreground();
    else {
      await this.telemetry.views.background();
      // Background clears the live root on both builds (§6.2), so a resumed app's first
      // fetch mints its own root rather than joining an action from before the user left.
      // *After* the view boundary, not before: the successor view is minted in there, and
      // clearing first would leave its freshly-minted `navigation` root as the carrier the
      // resumed app then joins.
      this.telemetry.trace.clear();
    }
  }
}
