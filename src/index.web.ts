// src/index.web.ts
import { TelemetryBase } from "./index.base";
import { debug, setDebug } from "./core/debug";

export { createTelemetry, type TelemetryOpts } from "./createTelemetry.web";

export class TelemetryWeb extends TelemetryBase {
    constructor(opts?: {
        apiKey?: string;
        sender?: any;
        batchSize?: number;
        flushIntervalMs?: number;
        endpoint?: string;
        captureConsole?: boolean;
        debug?: boolean;
    }) {
        setDebug(opts?.debug ?? false);   // gate SDK console noise before anything logs (#23)
        super();

        debug.log("🌍 Running Web Telemetry");

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

        // session.started on init (#29). Background/foreground via AppState is native-only.
        this.startSessionOnInit().catch(err => debug.warn("Web startSession failed:", err));

        this.trackErrors({ captureConsole: opts?.captureConsole }).catch(err => {
            debug.warn("Web trackErrors failed:", err);
        });

        this.trackFrameDrops().catch(err => {
            debug.log("Web trackFrameDrops errors", err);
        });
        this.trackNetworkRequests().catch(err => {
            debug.log("Web trackNetworkRequests errors", err);
        });
        this.trackMemoryUsage().catch(err => {
            debug.log("Web trackMemoryUsage errors", err);
        });
        this.autoTrackNavigation().catch(err => {
            debug.log("Web autoTrackNavigation errors", err);
        });
        this.attachAppLifecycle().catch(err => {
            debug.log("Web attachAppLifecycle errors", err);
        });
    }

    // app_lifecycle on tab visibility change — web equivalent of native AppState (#30)
    async attachAppLifecycle() {
        if (typeof document === "undefined") return;
        const inst = await this.instancePromise;
        const { AppLifecycleEmitter } = await import("./adapters/appLifecycle");
        const emitter = new AppLifecycleEmitter(inst);
        emitter.onState(document.visibilityState === "visible");   // seed current state
        document.addEventListener("visibilitychange", () =>
            emitter.onState(document.visibilityState === "visible"));
    }

    // Web uses the web crash handler (window.onerror/onunhandledrejection), not the native one.
    async trackErrors(options?: { captureConsole?: boolean }) {
        const { CrashHandler } = await import("./adapters/web/crashHandler.web");
        const inst = await this.instancePromise;
        const crashHandler = new CrashHandler(inst);
        return inst.trackErrors(crashHandler, options);
    }

    private async startSessionOnInit() {
        const inst = await this.instancePromise;
        await inst.startSession();
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
