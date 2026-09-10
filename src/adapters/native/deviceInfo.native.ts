// adapters/native/deviceInfoNative.native.ts
import { Dimensions, PixelRatio, Platform } from "react-native";
import DeviceInfoLib from "react-native-device-info";
import { Telemetry } from "../../core/telemetry";
import { DeviceInfo } from "../../core/telemetry";
import { viewportKeys } from "../viewport";

export class DeviceInfoTrackerNative {
    // private telemetry: Telemetry;

    // constructor(telemetry?: Telemetry) {
    //     this.telemetry = telemetry || new Telemetry();
    // }

    constructor() {
    }

    // device.id is NOT collected here (#91): it is self-minted and persisted by core.
    // getUniqueId() carries two lifetimes on RN alone — ANDROID_ID survives reinstall,
    // identifierForVendor does not — so one identity column would mean two things.
    async collect(): Promise<DeviceInfo> {
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

        // 🔹 Android-only fields
        const sdk = Platform.OS === "android" ? await DeviceInfoLib.getApiLevel() : undefined;
        const hardware = Platform.OS === "android" ? await DeviceInfoLib.getHardware?.() : undefined;
        const product = Platform.OS === "android" ? await DeviceInfoLib.getProduct?.() : undefined;

        // 🔹 iOS-only fields
        // ⚠ `getDeviceName()` — the user's own name for their phone — is deliberately NOT
        // read any more (§3.4): real PII, no column, no reader. `getFingerprint()` went with
        // it — a build string that merges handsets, which *repairs* device identity (§1.2).
        const iosSystemName = Platform.OS === "ios" ? systemName : undefined;

        // 🔹 §3.3 ✱ — device capability (native only) and viewport (both builds).
        const cpuAbi = (await DeviceInfoLib.supportedAbis?.())?.[0];
        const lowRam = await DeviceInfoLib.isLowRamDevice?.();

        // Read on every collect(), not cached: a device rotates mid-session, and §3.1 puts
        // `device.orientation` and device state on the log-time side of the freeze. The
        // *shaping* is shared with web (`adapters/viewport.ts`) so one column cannot come to
        // mean physical pixels on one build and dp on the other.
        const { width, height } = Dimensions.get("window");
        const viewport = viewportKeys(width, height, PixelRatio.get());

        const info: DeviceInfo = {
            app: {
                name: appName,
                version: appVersion,
                build_number: buildNumber,
                package_name: packageName,
            },
            device: {
                platform: Platform.OS,
                platform_version: systemVersion,
                model,
                manufacturer,
                brand,

                // Android fields
                android_sdk: sdk ? String(sdk) : undefined,
                android_release: Platform.OS === "android" ? systemVersion : undefined,
                hardware,
                product,
                cpu_abi: cpuAbi,
                low_ram: lowRam,

                // iOS fields
                ios_system_name: iosSystemName,

                // Viewport — both builds, never null (§3.3)
                ...viewport,
            },
        };

        return info;
    }

    /**
     * Context-only adapter. collect() feeds the Context block on every event;
     * start() emits no standalone device_info event (ADR-0002).
     */
    async start(_telemetry: Telemetry): Promise<void> {
        // no-op: device metadata rides as attributes on every event
    }
}
