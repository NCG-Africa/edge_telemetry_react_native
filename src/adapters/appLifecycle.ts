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

  onState(isActive: boolean): void {
    const previous = this.active;
    this.active = isActive;
    if (previous === undefined || previous === isActive) return;

    // Background is one of the four view boundaries (§4.5): the view ends and emits, and the
    // successor's clock starts paused so a night spent backgrounded is not charged as dwell.
    // Chained, not fired alongside, so the `app_lifecycle` row lands in the view it happened
    // in — `Promise.resolve` because a consumer-supplied double may return a plain value.
    void Promise.resolve(
      this.telemetry.log("app_lifecycle", {
        "app_lifecycle.state": isActive ? "foreground" : "background",
      }),
    ).then(() => (isActive ? this.telemetry.views.foreground() : this.telemetry.views.background()));
  }
}
