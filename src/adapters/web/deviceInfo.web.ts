// adapters/web/deviceInfoWeb.web.ts
import { DeviceInfo, Telemetry } from "../../core/telemetry";
import { viewportKeys } from "../viewport";

export class DeviceInfoTrackerWeb {
    private telemetry?: Telemetry;


    constructor() {
    }
    // device.id is NOT collected here (#91): core self-mints and persists it via the Store.
    async collect(): Promise<DeviceInfo> {
        const ua = navigator.userAgent;

        // §3.3 ✱ — viewport, read on every collect() because a browser window resizes and a
        // phone rotates; §3.1 keeps device state on the log-time side of the freeze. The
        // *viewport*, not `screen.*`: that is the quantity CLS and LCP scale with. Shaped by
        // the shared `adapters/viewport.ts`, so the key means the same thing native ships.
        const dpr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
        const viewport = viewportKeys(window.innerWidth ?? 0, window.innerHeight ?? 0, dpr);

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
                ...viewport,
            },
        };
    }

    async start(telemetry: Telemetry): Promise<void> {
        // context-only adapter — collect() feeds the Context block on every event;
        // no standalone device_info event (ADR-0002)
        this.telemetry = telemetry;
    }
}
