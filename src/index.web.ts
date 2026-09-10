// src/index.web.ts
import { TelemetryBase } from "./index.base";
import { debug, setDebug } from "./core/debug";
import type { SyncStore } from "./core/store";
import type { BeforeSend } from "./core/beforeSend";

export { createTelemetry, type TelemetryOpts } from "./createTelemetry.web";

// The Store port (#89) — public so a consumer can inject their own persistence,
// and so the in-memory fake is available outside the test tree.
export type { Store, SyncStore, AsyncStore, StoreRead, StoreWrite } from "./core/store";
export { memoryStore, type MemoryStoreOpts } from "./core/memoryStore";

// The scrubbing hook (#93) — public so a consumer can type their beforeSend.
export type { BeforeSend } from "./core/beforeSend";

export class TelemetryWeb extends TelemetryBase {
    constructor(opts?: {
        apiKey?: string;
        sender?: any;
        batchSize?: number;
        flushIntervalMs?: number;
        endpoint?: string;
        captureConsole?: boolean;
        debug?: boolean;
        store?: SyncStore;   // sync only: the web build's guarantee depends on it
        // Constructor-only (§3.6). No runtime setter: registering later leaves a window
        // where session.started and the earliest requests have already been enqueued.
        beforeSend?: BeforeSend;
        sessionSampleRate?: number;
    }) {
        setDebug(opts?.debug ?? false);   // gate SDK console noise before anything logs (#23)
        super();

        debug.log("🌍 Running Web Telemetry");

        this.instancePromise = (async () => {
            const { Telemetry } = await import("./core/telemetry");
            const { webSender } = await import("./adapters/webSender");
            const { webStore } = await import("./adapters/web/store.web");

            const { DeviceInfoTrackerWeb } = await import("./adapters/web/deviceInfo.web");
            const { NetworkInfoTrackerWeb } = await import("./adapters/web/networkInfo.web");
            const deviceInfoTrackerWeb = new DeviceInfoTrackerWeb();
            const networkInfoTrackerWeb = new NetworkInfoTrackerWeb();

            // One store, shared by the offline queue and core (#89) — so a consumer that
            // injects a store governs both, instead of the sender quietly keeping its own.
            const store = opts?.store ?? webStore();
            const sender = opts?.sender ?? webSender(opts?.endpoint, opts?.apiKey, store);

            const telemetry = new Telemetry({
                sender,
                batchSize: opts?.batchSize,
                flushIntervalMs: opts?.flushIntervalMs,
                endpoint: opts?.endpoint,
                // device.id is suffixed `_web`; session.id is not — §3.3 gives session.id a
                // `_web` suffix only in v4. generateSessionId() holds that rule.
                platform: "web",
                deviceInfoHandler: deviceInfoTrackerWeb,
                networkInfoHandler: networkInfoTrackerWeb,
                store,
                beforeSend: opts?.beforeSend,
                sessionSampleRate: opts?.sessionSampleRate,
            });

            // Resume or start the session before the instance is visible (#92). On web the
            // Store is localStorage, so a hard reload, a bfcache restore and a second tab
            // all resume the same session.
            // Never rethrown into instancePromise: finalizeSession() flushes, flush() rethrows on a
            // dead collector, and a rejected instancePromise would brick every public method for the
            // life of the process. Hydration has already run; only the emission is lost.
            await telemetry.resumeOrStartSession()
                .catch(err => debug.warn("Web session resume failed:", err));

            return telemetry;
        })();

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
        this.attachBfcacheRestore().catch(err => {
            debug.log("Web attachBfcacheRestore errors", err);
        });
    }

    /**
     * A bfcache restore resumes a frozen JS context, so the in-memory session survives on its
     * own — but the freeze can have outlasted the idle window, and a sibling tab may have
     * rotated the shared localStorage record while this one was suspended. Re-running the
     * init decision against the Store is what reconciles both (#92, §4.2).
     */
    private async attachBfcacheRestore() {
        if (typeof window === "undefined") return;
        const inst = await this.instancePromise;
        window.addEventListener("pageshow", (e: PageTransitionEvent) => {
            if (!e.persisted) return;   // an ordinary load already ran this at init
            inst.resumeOrStartSession()
                .catch((err: any) => debug.warn("Web bfcache session resume failed:", err));
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
