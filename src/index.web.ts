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
        // §6.4/#99 — bare hosts, exact match, ports ignored, empty by default.
        traceHostAllowlist?: string[];
        // §4.8 — symbolication resolve key. Omitted when unset, never `""`, never derived.
        buildId?: string;
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
                // §6.2: web's launch root reports true navigation start, which is *better*
                // than Android's fork-time-free approximation — and is why native's and
                // web's launch envelopes must not be compared as the same interval.
                traceLaunchStart: typeof performance !== "undefined" ? performance.timeOrigin : undefined,
                deviceInfoHandler: deviceInfoTrackerWeb,
                networkInfoHandler: networkInfoTrackerWeb,
                store,
                beforeSend: opts?.beforeSend,
                sessionSampleRate: opts?.sessionSampleRate,
                traceHostAllowlist: opts?.traceHostAllowlist,
                buildId: opts?.buildId,
                // §4.11: web has never emitted `screen.duration`, and a now-shared
                // attachNavigation must not be what starts it. `navigation` is untouched by
                // this flag — web's own history+popstate path still emits it (see the known
                // gap in CLAUDE.md); the flag only stops the ref path adding a second feed.
                deprecatedScreenFeeds: false,
            });

            // Resume or start the session before the instance is visible (#92). On web the
            // Store is localStorage, so a hard reload, a bfcache restore and a second tab
            // all resume the same session.
            // Never rethrown into instancePromise: finalizeSession() flushes, flush() rethrows on a
            // dead collector, and a rejected instancePromise would brick every public method for the
            // life of the process. Hydration has already run; only the emission is lost.
            // §4.5.2's `initial_load` seed: the launch view stays busy until the platform's
            // runtime-ready marker. The *module* is awaited with everything else, so the seed
            // is armed before `instancePromise` resolves; the *marker* is not, because on web
            // it arrives with the load event and blocking init on it would delay every host
            // call behind the page's own images.
            // The module is awaited so the seed is armed before `instancePromise` resolves,
            // but never rethrown into it: a failed chunk load must not brick every public
            // method for the life of the process. A missing reader just releases the gate.
            const { runtimeReadyAt } = await import("./adapters/web/runtimeReady.web")
                .catch((err: unknown) => {
                    debug.warn("Web runtime-ready module unavailable:", err);
                    return { runtimeReadyAt: async () => undefined };
                });
            const { seedRuntimeReady } = await import("./adapters/seedRuntimeReady");
            seedRuntimeReady(telemetry.views, runtimeReadyAt, "Web");

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
        this.autoTrackNavigation().catch(err => {
            debug.log("Web autoTrackNavigation errors", err);
        });
        this.trackInteractions().catch(err => {
            debug.log("Web trackInteractions errors", err);
        });
        this.trackWebVitals().catch(err => {
            debug.log("Web trackWebVitals errors", err);
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
        const onState = () => {
            const isActive = document.visibilityState === "visible";
            // Awaited before the flush, not fired alongside it — the same ordering native has
            // (§4.5). Backgrounding is a view boundary, and the rows it emits are exactly the
            // rows this flush exists to rescue: the `view` row, and §5.3's drained CLS and INP,
            // whose whole reason for being held is that the library's page-hide report loses
            // them on a closed tab. Holding them and then not flushing would move that defect
            // rather than close it. Web's sender uses `fetch({keepalive:true})`, which is what
            // lets a hidden tab's batch outlive the document.
            return emitter.onState(isActive)
                .then(() => (isActive ? undefined : inst.flush()))
                .catch((e: any) => debug.warn("Web app lifecycle failed:", e));
        };
        onState();   // seed current state
        document.addEventListener("visibilitychange", onState);
    }

    // Web uses the web crash handler (window.onerror/onunhandledrejection), not the native one.
    async trackErrors(options?: { captureConsole?: boolean }) {
        const { CrashHandler } = await import("./adapters/web/crashHandler.web");
        const inst = await this.instancePromise;
        const crashHandler = new CrashHandler(inst);
        return inst.trackErrors(crashHandler, options);
    }

    async trackFrameDrops() {
        const { FrameDropTracker } = await import("./adapters/frameTracker");
        const inst = await this.instancePromise;
        const frameDropTracker = new FrameDropTracker(inst);
        return inst.trackFrameDrops(frameDropTracker);
    }

    async trackNetworkRequests() {
        const { NetworkTrackerWeb } = await import("./adapters/web/interceptFetchWeb.web");
        const inst = await this.instancePromise;
        const networkTracker = new NetworkTrackerWeb(inst);
        return inst.trackNetworkRequests(networkTracker);
    }

    // §5.2/#105: web emits no `memory_usage` at all, and exposes no `trackMemoryUsage`.
    // Why, in CLAUDE.md's `memory_usage` section.

    /**
     * §4.6/#102 — one capture-phase `click` listener on `document`. Auto-started, like every
     * other capture: `ui.interaction` is what §6.2's interaction root hangs off, so a
     * consumer forgetting to call it would leave every tap-driven request unattributed.
     */
    async trackInteractions() {
        const { InteractionTrackerWeb } = await import("./adapters/web/interactionWeb.web");
        const inst = await this.instancePromise;
        // One tracker per core instance, like the XHR patch: `start()`'s own guard is
        // per-tracker, so constructing a fresh one on a second call would add a second
        // capture-phase listener and double every `ui.interaction` row.
        (inst.webInteractions ??= new InteractionTrackerWeb(inst)).start();
    }

    /**
     * §5.3/#106 — the five Core Web Vitals on the metric path, web only. Auto-started and
     * deliberately not public API: there is nothing for a consumer to configure, and a vital
     * that only fires if someone remembered to call a method is a vital nobody has.
     *
     * `web-vitals/attribution` is bundled, so this is the only import of it in the tree and
     * `index.native` never reaches it. A failed chunk load is caught by the caller and costs
     * the vitals, nothing else.
     */
    private async trackWebVitals() {
        const { WebVitalsTracker } = await import("./adapters/web/webVitals.web");
        const inst = await this.instancePromise;
        // One tracker per core instance: `start()`'s guard is per-tracker, so a fresh one on a
        // second call would double-subscribe and double every vital row.
        await (inst.webVitals ??= new WebVitalsTracker(inst)).start();
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
