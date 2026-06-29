// src/index.web.ts
import { TelemetryBase } from "./index.base";

export { createTelemetry, type TelemetryOpts } from "./createTelemetry.web";

export class TelemetryWeb extends TelemetryBase {
    constructor(opts?: {
        apiKey?: string;
        sender?: any;
        batchSize?: number;
        flushIntervalMs?: number;
        endpoint?: string;
    }) {
        super();

        console.log("🌍 Running Web Telemetry");

        this.instancePromise = (async () => {
            const { Telemetry } = await import("./core/telemetry");
            const { webSender } = await import("./adapters/webSender");

            const { DeviceInfoTrackerWeb } = await import("./adapters/web/deviceInfo.web");
            const { NetworkInfoTrackerWeb } = await import("./adapters/web/networkInfo.web");
            const deviceInfoTrackerWeb = new DeviceInfoTrackerWeb();
            const networkInfoTrackerWeb = new NetworkInfoTrackerWeb();

            const sender = opts?.sender ?? webSender(opts?.endpoint, opts?.apiKey);

            const telemetry = new Telemetry({
                sender,
                batchSize: opts?.batchSize,
                flushIntervalMs: opts?.flushIntervalMs,
                endpoint: opts?.endpoint,
                // no id suffix on web: the contract suffix is ios|android only.
                // device.platform="web" still rides as an attribute from the adapter.
                deviceInfoHandler: deviceInfoTrackerWeb,
                networkInfoHandler: networkInfoTrackerWeb,
            });

            return telemetry;
        })();

        this.trackErrors().catch(err => {
            console.warn("Web trackErrors failed:", err);
        });

        this.trackFrameDrops().catch(err => {
            console.log("Web trackFrameDrops errors", err);
        });
        this.trackNetworkRequests().catch(err => {
            console.log("Web trackNetworkRequests errors", err);
        });
        this.trackMemoryUsage().catch(err => {
            console.log("Web trackMemoryUsage errors", err);
        });
        this.autoTrackNavigation().catch(err => {
            console.log("Web autoTrackNavigation errors", err);
        });
    }

    async trackFrameDrops() {
        const { FrameDropTrackerWeb } = await import("./adapters/web/frameDropsWeb.web");
        const inst = await this.instancePromise;
        const frameDropTracker = new FrameDropTrackerWeb(inst);
        return inst.trackFrameDrops(frameDropTracker);
    }

    async trackNetworkRequests() {
        const { NetworkTrackerWeb } = await import("./adapters/web/interceptFetchWeb.web");
        const inst = await this.instancePromise;
        const networkTracker = new NetworkTrackerWeb(inst);
        return inst.trackNetworkRequests(networkTracker);
    }

    async trackMemoryUsage() {
        const { TelemetryMemoryUsageWeb } = await import("./adapters/web/memoryWeb.web");
        const inst = await this.instancePromise;
        const memoryTracker = new TelemetryMemoryUsageWeb(inst);
        return inst.trackMemoryUsage(memoryTracker);
    }

    async autoTrackNavigation() {
        const { NavigationTrackerWeb } = await import("./adapters/web/navigationWeb.web");
        const inst = await this.instancePromise;
        const navigationTracker = new NavigationTrackerWeb(inst);
        return inst.start(navigationTracker);
    }

    async getDeviceInfo() {
        const { DeviceInfoTrackerWeb } = await import("./adapters/web/deviceInfo.web");
        const inst = await this.instancePromise;
        const deviceInfoTrackerWeb = new DeviceInfoTrackerWeb();
        return inst.getDeviceInfo(deviceInfoTrackerWeb);
    }

    async getNetworkInfo() {
        const { NetworkInfoTrackerWeb } = await import("./adapters/web/networkInfo.web");
        const inst = await this.instancePromise;
        const networkInfoTrackerWeb = new NetworkInfoTrackerWeb();
        return inst.getNetworkInfo(networkInfoTrackerWeb);
    }
}
