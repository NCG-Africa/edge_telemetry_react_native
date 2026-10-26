import type { DeviceStateHandler } from "../../core/telemetry";

/**
 * #173, web. Only `device.reduce_motion`, via `matchMedia`. No battery — `navigator.getBattery`
 * is Chromium-only, a browser-detection signal wearing a battery label (§5.2's defect) — and no
 * screen reader or font scale: RN-Web answers both with constants, and a fake value is worse
 * than none.
 */
export class DeviceStateWeb implements DeviceStateHandler {
    async accessibility(): Promise<Record<string, boolean>> {
        try {
            const mq = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : undefined;
            return typeof mq?.matches === "boolean" ? { "device.reduce_motion": mq.matches } : {};
        } catch {
            return {};
        }
    }
}
