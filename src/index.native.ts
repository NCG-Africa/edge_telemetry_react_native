

export class TelemetryNative {
    private instancePromise: Promise<any>;
    // private memoryTracker?: TelemetryMemoryUsageNative;

    // private frameDrops?: FrameDropTrackerNative;
    // private screens?: ScreenTimingTracker;
    // private navigation?: NavigationTracker;
    // private crashHandler?: CrashHandlerNative;



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
            const { interceptFetch } = await import("./adapters/native/interceptFetchNative.native");
            const { generateId } = await import("./core/utils/uuid.native");
            const sender = opts?.sender ?? nativeSender(opts?.endpoint);

            //metrics and trackers
            const { TelemetryMemoryUsageNative } = await import("./adapters/native/memoryNative.native");
            const { FrameDropTrackerNative } = await import("./adapters/native/frameDropsNative.native");
            const { ScreenTimingTracker } = await import("./adapters/screenTiming");
            const { NavigationTrackerNative } = await import("./adapters/native/navigationNative.native");
            const { CrashHandlerNative } = await import("./adapters/native/crashHandlerNative.native");


            const telemetry = new Telemetry({
                sender,
                batchSize: opts?.batchSize,
                flushIntervalMs: opts?.flushIntervalMs,
                endpoint: opts?.endpoint,
                RandomnStringGenerator: { generate: generateId },
            });

            // 🔥 Auto-init HTTP interception
            interceptFetch(telemetry);
            // auto init memory tracker
            const memoryTracker = new TelemetryMemoryUsageNative(telemetry);
            memoryTracker.start();

            // --- auto initialize modules ---
            const frameDrops = new FrameDropTrackerNative(telemetry);
            frameDrops.start();

            const screens = new ScreenTimingTracker(telemetry);

            const navigationTracker = new NavigationTrackerNative(telemetry);

            const crashHandler = new CrashHandlerNative(telemetry);
            crashHandler.attach();


            return telemetry;
        })();
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
        const inst = await this.instancePromise;
        const { NavigationTrackerNative } = await import("./adapters/native/navigationNative.native");
        const tracker = new NavigationTrackerNative(inst);
        tracker.attach(navigationRef);
    }


}



