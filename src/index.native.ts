// React Native telemetry implementation
import { TelemetryBase } from "./index.base";
import { debug, setDebug } from "./core/debug";

export { createTelemetry, type TelemetryOpts } from "./createTelemetry.native";

export class TelemetryNative extends TelemetryBase {
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

        debug.log("🌍 Running Native Telemetry");
        this.instancePromise = (async () => {
            const { Telemetry } = await import("./core/telemetry");
            const { nativeSender } = await import("./adapters/nativeSender");

            const { replayFailedNative } = await import("./adapters/nativeSender");
            const { DeviceInfoTrackerNative } = await import("./adapters/native/deviceInfo.native");
            const { NetworkInfoTrackerNative } = await import("./adapters/native/networkInfo.native");

            // device OS forms the device/session id suffix (ios|android)
            let platform: string | undefined;
            try {
                ({ Platform: { OS: platform } } = await import("react-native") as any);
            } catch { /* non-RN context (e.g. tests) — omit the suffix */ }

            const networkInfoTrackerNative = new NetworkInfoTrackerNative();
            const deviceInfoTrackerNative = new DeviceInfoTrackerNative();

            const sender = opts?.sender ?? nativeSender(opts?.endpoint, opts?.apiKey);

            const telemetry = new Telemetry({
                sender,
                batchSize: opts?.batchSize,
                flushIntervalMs: opts?.flushIntervalMs,
                endpoint: opts?.endpoint,
                platform,
                deviceInfoHandler: deviceInfoTrackerNative,
                networkInfoHandler: networkInfoTrackerNative,
            });

            // 🔄 recover failed events right after init
            replayFailedNative(opts?.endpoint, opts?.apiKey).catch(err => {
                debug.warn("Native replay failed:", err);
            });

            return telemetry;
        })();

        // session.started on init; AppState drives background→finalize, foreground→new session (#29)
        this.startSessionOnInit().catch(err => debug.warn("Native startSession failed:", err));
        this.attachAppState().catch(err => debug.warn("Native AppState attach failed:", err));

        // app_lifecycle on foreground/background (#30)
        this.attachAppLifecycle().catch(err => {
            debug.log("Native attachAppLifecycle errors", err);
        });

        this.trackErrors({ captureConsole: opts?.captureConsole }).catch(err => {
            debug.warn("Native trackErrors failed:", err);
        });

        this.trackFrameDrops().catch(err => {
            debug.log("Native trackFrameDrops errors", err);
        });
        this.trackNetworkRequests().catch(err => {
            debug.log("Native trackNetworkRequests errors", err);
        });
        this.trackMemoryUsage().catch(err => {
            debug.log("Native trackMemoryUsage errors", err);
        });
    }

    private async startSessionOnInit() {
        const inst = await this.instancePromise;
        await inst.startSession();
    }

    // Background → finalize (immediate flush). Foreground after background → fresh session. (#29)
    private async attachAppState() {
        const { AppState } = await import("react-native") as any;
        const inst = await this.instancePromise;
        let prev: string = AppState.currentState;
        AppState.addEventListener("change", (next: string) => {
            if (next === "background") {
                inst.finalizeSession().catch((e: any) => debug.warn("finalizeSession failed:", e));
            } else if (next === "active" && prev === "background") {
                inst.newSession().catch((e: any) => debug.warn("newSession failed:", e));
            }
            prev = next;
        });
    }

    // app_lifecycle on foreground/background via RN AppState (#30)
    async attachAppLifecycle() {
        const { AppState } = await import("react-native") as any;
        const inst = await this.instancePromise;
        const { AppLifecycleEmitter } = await import("./adapters/appLifecycle");
        const emitter = new AppLifecycleEmitter(inst);
        emitter.onState(AppState.currentState === "active");   // seed current state
        AppState.addEventListener("change", (next: string) => emitter.onState(next === "active"));
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

    // ---------- Screen Management ----------

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

    // Best-effort native taps → user.interaction (#33). Spread the returned props on your
    // app root <View>; each tap emits user.interaction with the current screen when known.
    //   const props = await telemetry.interactionProps();
    //   <View {...props}>{app}</View>
    async interactionProps() {
        const inst = await this.instancePromise;
        const { InteractionEmitter } = await import("./adapters/interaction");
        return new InteractionEmitter(inst).responderProps();
    }

    async attachNavigation(navigationRef: any) {
        debug.log("Attaching navigation tracker");
        if (!navigationRef) {
            debug.warn("Navigation reference is undefined. Cannot attach navigation tracker.");
            return;
        }
        const inst = await this.instancePromise;
        const { NavigationTrackerNative } = await import("./adapters/native/navigationNative.native");
        const tracker = new NavigationTrackerNative(inst);
        tracker.attach(navigationRef);
    }
}
