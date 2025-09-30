// src/index.web.ts
// import { TelemetryMemoryUsageWeb } from "./adapters/web/memoryWeb.web";

export class TelemetryWeb {
    private instancePromise: Promise<any>;

    // private memoryTracker?: TelemetryMemoryUsageWeb;

    constructor(opts?: {
        sender?: any;
        batchSize?: number;
        flushIntervalMs?: number;
        endpoint?: string;
    }) {

        console.log("🌍 Running Web Telemetry");

        this.instancePromise = (async () => {
            const { Telemetry } = await import("./core/telemetry");
            const { webSender } = await import("./adapters/webSender");
            const { generateId } = await import("./core/utils/uuid.web");

            const { DeviceInfoTrackerWeb } = await import("./adapters/web/deviceInfo.web");
            const { NetworkInfoTrackerWeb } = await import("./adapters/web/networkInfo.web");
            const deviceInfoTrackerWeb = new DeviceInfoTrackerWeb();
            const networkInfoTrackerWeb = new NetworkInfoTrackerWeb();

            ;
            const sender = webSender(opts?.endpoint);

            const telemetry = new Telemetry({
                sender,
                batchSize: opts?.batchSize,
                flushIntervalMs: opts?.flushIntervalMs,
                endpoint: opts?.endpoint,
                RandomnStringGenerator: { generate: generateId },
                deviceInfoHandler: deviceInfoTrackerWeb,
                networkInfoHandler: networkInfoTrackerWeb,
            });

            // // auto init memory tracker
            // this.memoryTracker = new TelemetryMemoryUsageWeb(telemetry);
            // this.memoryTracker.start(); // runs every 30s by default


            return telemetry;
        })();

        this.trackErrors().catch(err => {
            console.warn("Web TelemetryNative trackErrors failed:", err);
        });



        this.trackFrameDrops().catch(err => {
            console.log("Web trackFrameDrops(frameDropsHandler: FrameDropsHandler) errors", err);
        })
        this.trackNetworkRequests().catch(err => {
            console.log("Web trackNetworkRequests(networkHandler: NetworkHandler) errors", err);
        })
        this.trackMemoryUsage().catch(err => {
            console.log("Web trackMemoryUsage(memoryHandler: MemoryHandler) errors", err);
        })

        this.autoTrackNavigation().catch(err => {
            console.log("Web autoTrackNavigation errors", err);
        })

    }

    async trackErrors() {
        const { CrashHandlerNative } = await import("./adapters/native/crashHandlerNative.native");
        const inst = await this.instancePromise;
        const crashHandler = new CrashHandlerNative(inst);
        return inst.trackErrors(crashHandler);
    }

    //       trackFrameDrops(frameDropsHandler: FrameDropsHandler): Promise<void> {
    //    trackNetworkRequests(networkHandler: NetworkHandler): Promise<void> {
    //   trackMemoryUsage(memoryHandler: MemoryHandler): Promise<void> {
    //    autoTrackNavigation(navigationHandler?: NavigationHandler): Promise<void> {

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


    async log(event: string, data?: Record<string, any>) {
        const inst = await this.instancePromise;
        return inst.log(event, data);
    }

    async flush() {
        const inst = await this.instancePromise;
        return inst.flush();
    }

    async shutdown() {
        const inst = await this.instancePromise;
        return inst.shutdown();
    }
}




// export class TelemetryWeb {
//     private instancePromise: Promise<any>;

//     constructor(opts?: {
//         sender?: any;
//         batchSize?: number;
//         flushIntervalMs?: number;
//         endpoint?: string;             // 👈 allow endpoint
//     }) {
//         this.instancePromise = (async () => {
//             const { Telemetry } = await import("./core/telemetry");
//             const sender = opts?.sender ?? (await import("./adapters/webSender")).webSender;
//             return new Telemetry({
//                 sender,
//                 batchSize: opts?.batchSize,
//                 flushIntervalMs: opts?.flushIntervalMs,
//                 endpoint: opts?.endpoint,  // 👈 forward endpoint
//             });
//         })();
//     }

//     async log(event: string, data?: Record<string, any>) {
//         const inst = await this.instancePromise;
//         return inst.log(event, data);
//     }

//     async flush() {
//         const inst = await this.instancePromise;
//         return inst.flush();
//     }

//     async shutdown() {
//         const inst = await this.instancePromise;
//         return inst.shutdown();
//     }
// }




