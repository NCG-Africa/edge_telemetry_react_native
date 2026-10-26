import { AccessibilityInfo, PixelRatio } from "react-native";
import DeviceInfoLib from "react-native-device-info";
import { debug } from "../../core/debug";
import type { DeviceStateHandler } from "../../core/telemetry";
import { batteryAttributes, isBool, isFiniteNumber, readOr } from "../deviceState";

/** Refresh cadence of the cached battery read (#173). Internal. */
const BATTERY_REFRESH_MS = 60000;

/**
 * #173, native. Battery is a **cached** read — refreshed at start, on foreground and every 60 s —
 * so a failure row never awaits a native call. `react-native-device-info` is an optional peer and
 * an older one lacks these methods, so every read is optional-chained and guarded.
 */
export class DeviceStateNative implements DeviceStateHandler {
    private cached: Record<string, number | boolean> = {};
    private timer: ReturnType<typeof setInterval> | null = null;

    battery(): Record<string, number | boolean> {
        return this.cached;
    }

    async refresh(): Promise<void> {
        const lib = DeviceInfoLib as any;
        const [level, charging, power] = await Promise.all([
            readOr(() => lib?.getBatteryLevel?.(), isFiniteNumber),
            readOr(() => lib?.isBatteryCharging?.(), isBool),
            readOr(() => lib?.getPowerState?.(), (v) => typeof v === "object" && v !== null),
        ]);
        this.cached = batteryAttributes(level, charging, (power as any)?.lowPowerMode);
    }

    start(): void {
        if (this.timer !== null) return;
        const refresh = () => { this.refresh().catch((err) => debug.warn("battery refresh failed:", err)); };
        refresh();
        this.timer = setInterval(refresh, BATTERY_REFRESH_MS);
    }

    stop(): void {
        if (this.timer !== null) clearInterval(this.timer);
        this.timer = null;
    }

    async accessibility(): Promise<Record<string, number | boolean>> {
        const a11y = AccessibilityInfo as any;
        const [screenReader, reduceMotion, fontScale] = await Promise.all([
            readOr(() => a11y?.isScreenReaderEnabled?.(), isBool),
            readOr(() => a11y?.isReduceMotionEnabled?.(), isBool),
            readOr(() => (PixelRatio as any)?.getFontScale?.(), isFiniteNumber),
        ]);
        return {
            ...(screenReader === undefined ? {} : { "device.screen_reader": screenReader as boolean }),
            ...(reduceMotion === undefined ? {} : { "device.reduce_motion": reduceMotion as boolean }),
            ...(fontScale === undefined ? {} : { "device.font_scale": fontScale as number }),
        };
    }
}
