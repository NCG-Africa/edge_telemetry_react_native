// adapters/native/deviceInfoNative.native.ts
import { Platform } from "react-native";
import DeviceInfoLib from "react-native-device-info";
import { v4 as uuidv4 } from "uuid";
import { Telemetry } from "../../core/telemetry";
import { DeviceInfo } from "../../core/telemetry";

export class DeviceInfoTrackerNative {
    // private telemetry: Telemetry;

    // constructor(telemetry?: Telemetry) {
    //     this.telemetry = telemetry || new Telemetry();
    // }

    constructor() {
    }

    async collect(): Promise<DeviceInfo> {
        // 🔹 Device ID
        let uniqueId = "";
        try {
            uniqueId = await DeviceInfoLib.getUniqueId();
        } catch {
            uniqueId = `device_${Date.now()}_${uuidv4()}_${Platform.OS}`;
        }

        // 🔹 App metadata
        const appName = (await DeviceInfoLib.getApplicationName()) || "UnknownApp";
        const appVersion = (await DeviceInfoLib.getVersion()) || "0.0.0";
        const buildNumber = (await DeviceInfoLib.getBuildNumber()) || "0";
        const packageName = (await DeviceInfoLib.getBundleId()) || "unknown.package";

        // 🔹 Common Device metadata
        const brand = await DeviceInfoLib.getBrand();
        const manufacturer = (await DeviceInfoLib.getManufacturer()) || "";
        const model = (await DeviceInfoLib.getModel()) || "";
        const systemVersion = (await DeviceInfoLib.getSystemVersion()) || "";
        const systemName = (await DeviceInfoLib.getSystemName()) || ""; // iOS: "iOS", Android: "Android"
        const deviceName = (await DeviceInfoLib.getDeviceName()) || "";

        // 🔹 Android-only fields
        const sdk = Platform.OS === "android" ? await DeviceInfoLib.getApiLevel() : undefined;
        const fingerprint = Platform.OS === "android" ? await DeviceInfoLib.getFingerprint?.() : undefined;
        const hardware = Platform.OS === "android" ? await DeviceInfoLib.getHardware?.() : undefined;
        const product = Platform.OS === "android" ? await DeviceInfoLib.getProduct?.() : undefined;

        // 🔹 iOS-only fields
        const iosSystemName = Platform.OS === "ios" ? systemName : undefined;
        const iosDeviceName = Platform.OS === "ios" ? deviceName : undefined;

        const info: DeviceInfo = {
            app: {
                name: appName,
                version: appVersion,
                buildNumber,
                packageName,
            },
            device: {
                id: uniqueId,
                platform: Platform.OS,
                platformVersion: systemVersion,
                model,
                manufacturer,
                brand,

                // Android fields
                androidSdk: sdk ? String(sdk) : undefined,
                androidRelease: Platform.OS === "android" ? systemVersion : undefined,
                fingerprint,
                hardware,
                product,

                // iOS fields
                iosSystemName,
                iosDeviceName,
            },
        };

        return info;
    }

    /**
     * Collects and logs the device/app metadata.
     */
    async start(telemetry: Telemetry): Promise<void> {
        const info = await this.collect();
        telemetry.log("device_info", info);
    }
}
