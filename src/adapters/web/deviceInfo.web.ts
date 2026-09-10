// adapters/web/deviceInfoWeb.web.ts
import { DeviceInfo, Telemetry } from "../../core/telemetry";

export class DeviceInfoTrackerWeb {
    private telemetry?: Telemetry;


    constructor() {
    }
    // device.id is NOT collected here (#91): core self-mints and persists it via the Store.
    async collect(): Promise<DeviceInfo> {
        const ua = navigator.userAgent;

        // §3.3 ✱ — viewport, read on every collect() because a browser window resizes and a
        // phone rotates; §3.1 keeps device state on the log-time side of the freeze.
        // CSS px x DPR, so the key means the same quantity as native's `Dimensions` x
        // `PixelRatio`. ponytail: no `screen.orientation` read — the width/height compare is
        // the same two values the successor keys already ship, and it needs no feature check.
        const dpr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
        const w = window.innerWidth ?? 0;
        const h = window.innerHeight ?? 0;

        return {
            app: {
                name: document.title || "WebApp",
                version: process.env.APP_VERSION || "1.0.0",
                build_number: process.env.BUILD_NUMBER,
                package_name: window.location.hostname,
            },
            device: {
                platform: "web",
                platform_version: navigator.appVersion,
                model: ua,
                manufacturer: "browser",
                brand: navigator.vendor || "unknown",

                // Android placeholders
                android_sdk: undefined,
                android_release: undefined,
                hardware: undefined,
                product: undefined,

                // iOS placeholders
                ios_system_name: undefined,

                // `cpu_abi` / `low_ram` are native-only (§3.3's `N`) — a browser exposes
                // neither, and a fabricated value is worse than an absent key.
                screen_density: dpr,
                screen_width_px: Math.round(w * dpr),
                screen_height_px: Math.round(h * dpr),
                orientation: w > h ? "landscape" : "portrait",
            },
        };
    }

    async start(telemetry: Telemetry): Promise<void> {
        // context-only adapter — collect() feeds the Context block on every event;
        // no standalone device_info event (ADR-0002)
        this.telemetry = telemetry;
    }
}
