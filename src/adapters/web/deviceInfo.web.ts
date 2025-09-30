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
                buildNumber: process.env.BUILD_NUMBER,
                packageName: window.location.hostname,
            },
            device: {
                id: `device_${Date.now()}_${uuidv4()}_web`,
                platform: "web",
                platformVersion: navigator.appVersion,
                model: ua,
                manufacturer: "browser",
                brand: navigator.vendor || "unknown",

                // Android placeholders
                androidSdk: undefined,
                androidRelease: undefined,
                fingerprint: undefined,
                hardware: undefined,
                product: undefined,

                // iOS placeholders
                iosSystemName: undefined,
                iosDeviceName: undefined,
            },
        };
    }

    async start(telemetry: Telemetry): Promise<void> {
        this.telemetry = telemetry;
        const info = await this.collect();
        this.telemetry.log("device_info", info);
    }
}
