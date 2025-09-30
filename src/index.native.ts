import { error } from "console";


export class TelemetryNative {
    private instancePromise: Promise<any>;

    constructor(opts?: {
        sender?: any;
        batchSize?: number;
        flushIntervalMs?: number;
        endpoint?: string;
    }) {

        console.log("🌍 Running Native Telemetry");
        this.instancePromise = (async () => {
            const { Telemetry } = await import("./core/telemetry");
            const { nativeSender } = await import("./adapters/nativeSender");

            const { replayFailedNative } = await import("./adapters/nativeSender");
            const { generateId } = await import("./core/utils/uuid.native");
            const { DeviceInfoTrackerNative } = await import("./adapters/native/deviceInfo.native");
            const { NetworkInfoTrackerNative } = await import("./adapters/native/networkInfo.native");

            const networkInfoTrackerNative = new NetworkInfoTrackerNative();
            const deviceInfoTrackerNative = new DeviceInfoTrackerNative();

            const sender = opts?.sender ?? nativeSender(opts?.endpoint);


            const telemetry = new Telemetry({
                sender,
                batchSize: opts?.batchSize,
                flushIntervalMs: opts?.flushIntervalMs,
                endpoint: opts?.endpoint,
                RandomnStringGenerator: { generate: generateId },
                deviceInfoHandler: deviceInfoTrackerNative,
                networkInfoHandler: networkInfoTrackerNative,
            });

            // 🔄 recover failed events right after init
            replayFailedNative(opts?.endpoint).catch(err => {
                console.warn("Native replay failed:", err);
            });

            // … attach interceptors, trackers, crash handlers, etc.
            return telemetry;
        })();

        this.trackErrors().catch(err => {
            console.warn("Native TelemetryNative trackErrors failed:", err);
        });

        this.trackFrameDrops().catch(err => {
            console.log("Native trackFrameDrops(frameDropsHandler: FrameDropsHandler) errors", err);
        })
        this.trackNetworkRequests().catch(err => {
            console.log("Native trackNetworkRequests(networkHandler: NetworkHandler) errors", err);
        })
        this.trackMemoryUsage().catch(err => {
            console.log("Native rackMemoryUsage(memoryHandler: MemoryHandler) errors", err);
        })
    }

    async getDeviceInfo() {
        const { DeviceInfoTrackerNative } = await import("./adapters/native/deviceInfo.native");
        const inst = await this.instancePromise;
        const deviceInfoTrackerNative = new DeviceInfoTrackerNative();
        return inst.getDeviceInfo(deviceInfoTrackerNative);
    }

    async getNetworkInfo() {
        const { NetworkInfoTrackerNative } = await import("./adapters/native/networkInfo.native");
        const inst = await this.instancePromise;
        const networkInfoTrackerNative = new NetworkInfoTrackerNative();
        return inst.getNetworkInfo(networkInfoTrackerNative);
    }

    async trackErrors() {
        const { CrashHandlerNative } = await import("./adapters/native/crashHandlerNative.native");
        const inst = await this.instancePromise;
        const crashHandler = new CrashHandlerNative(inst);
        return inst.trackErrors(crashHandler);
    }
    async trackFrameDrops() {
        const { FrameDropTrackerNative } = await import("./adapters/native/frameDropsNative.native");
        const inst = await this.instancePromise;
        const frameDropTracker = new FrameDropTrackerNative(inst);
        return inst.trackFrameDrops(frameDropTracker);
    }
    async trackNetworkRequests() {
        const { NetworkTrackerNative } = await import("./adapters/native/interceptFetchNative.native");
        const inst = await this.instancePromise;
        const networkTracker = new NetworkTrackerNative(inst);
        return inst.trackNetworkRequests(networkTracker);
    }
    async trackMemoryUsage() {
        const { TelemetryMemoryUsageNative } = await import("./adapters/native/memoryNative.native");
        const inst = await this.instancePromise;
        const memoryTracker = new TelemetryMemoryUsageNative(inst);
        return inst.trackMemoryUsage(memoryTracker);
    }

    async log(event: string, data?: Record<string, any>) {
        const inst = await this.instancePromise;
        return inst.log(event, data);
    }

    async flush() {
        const inst = await this.instancePromise;
        return inst.flush();
    }


    async setUserId(id: string) {
        const inst = await this.instancePromise;
        inst.setUserId(id);
    }

    async generateUserId() {
        const inst = await this.instancePromise;

        return inst.generateUserId();
    }


    async screenStart(name: string) {
        const inst = await this.instancePromise;
        inst.screens.startScreen(name);
    }

    async screenEnd(name: string) {
        const inst = await this.instancePromise;
        inst.screens.endScreen(name);
    }

    async trackRoute(from: string, to: string) {
        const inst = await this.instancePromise;
        inst.recordRouteChange(from, to);
    }


    async shutdown() {
        const inst = await this.instancePromise;
        return inst.shutdown();
    }

    // index.native.ts
    async attachNavigation(navigationRef: any) {
        console.log("Attaching navigation tracker");
        if (!navigationRef) {
            console.warn("Navigation reference is undefined. Cannot attach navigation tracker.");
            return;
        }
        const inst = await this.instancePromise;
        const { NavigationTrackerNative } = await import("./adapters/native/navigationNative.native");
        const tracker = new NavigationTrackerNative(inst);
        tracker.attach(navigationRef);
    }


}



