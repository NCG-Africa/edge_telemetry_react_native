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
    if (this.active !== undefined && this.active !== isActive) {
      this.telemetry.log("app_lifecycle", {
        "app_lifecycle.state": isActive ? "foreground" : "background",
      });
    }
    this.active = isActive;
  }
}
