import { Telemetry } from "../core/telemetry";

/**
 * Shared connectivity-transition emitter — the single source of truth so the web and
 * native network adapters stay in lockstep on the v3 `network_change` contract (#27).
 *
 * Feed it every connectivity sample via `onSample`. It emits `network_change` only on an
 * actual type transition, carrying `network.previous_type`; the current `network.*` context
 * rides on the event via the Context block (and is echoed here for an explicit at-emit value).
 */
export class NetworkChangeEmitter {
  private previousType?: string;

  constructor(private telemetry: Telemetry) {}

  onSample(currentType: string | undefined): void {
    const prev = this.previousType;
    if (prev !== undefined && prev !== currentType) {
      this.telemetry.log("network_change", {
        "network.previous_type": prev,
        "network.type": currentType,
      });
    }
    this.previousType = currentType;
  }
}
