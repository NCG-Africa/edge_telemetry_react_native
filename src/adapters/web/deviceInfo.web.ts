// adapters/web/deviceInfoWeb.web.ts
import { v4 as uuidv4 } from "uuid";
import { DeviceInfo, Telemetry } from "../../core/telemetry";

export class DeviceInfoTrackerWeb {
    private telemetry?: Telemetry;


    constructor() {
    }
    async collect(): Promise<DeviceInfo> {
        const ua = navigator.userAgent;
        const platform = navigator.platform;

        return {
            app: {
                name: document.title || "WebApp",
                version: process.env.APP_VERSION || "1.0.0",
                build_number: process.env.BUILD_NUMBER,
                package_name: window.location.hostname,
            },
            device: {
                id: `device_${Date.now()}_${uuidv4()}_web`,
                platform: "web",
                platform_version: navigator.appVersion,
                model: ua,
                manufacturer: "browser",
                brand: navigator.vendor || "unknown",

                // Android placeholders
                android_sdk: undefined,
                android_release: undefined,
                fingerprint: undefined,
                hardware: undefined,
                product: undefined,

                // iOS placeholders
                ios_system_name: undefined,
                iosDeviceName: undefined,
            },
        };
    }

    async start(telemetry: Telemetry): Promise<void> {
        // context-only adapter — collect() feeds the Context block on every event;
        // no standalone device_info event (ADR-0002)
        this.telemetry = telemetry;
    }
}
