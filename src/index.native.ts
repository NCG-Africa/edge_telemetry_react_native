// React Native telemetry implementation
import { TelemetryBase } from "./index.base";
import { debug, setDebug } from "./core/debug";
import { RAGE_WINDOW_MS, RageTracker, UI_UNNAMED, uiAttributes } from "./adapters/uiInteraction";
import type { Store } from "./core/store";
import type { BeforeSend } from "./core/beforeSend";

export { createTelemetry, type TelemetryOpts } from "./createTelemetry.native";

// The Store port (#89) — public so a consumer can inject their own persistence,
// and so the in-memory fake is available outside the test tree.
export type { Store, SyncStore, AsyncStore, StoreRead, StoreWrite } from "./core/store";
export { memoryStore, type MemoryStoreOpts } from "./core/memoryStore";

// The scrubbing hook (#93) — public so a consumer can type their beforeSend.
export type { BeforeSend } from "./core/beforeSend";

export class TelemetryNative extends TelemetryBase {
    /** ≥3 named taps in a 1000 ms window, keyed on the name — see `trackTap`. */
    private readonly tapRage = new RageTracker(RAGE_WINDOW_MS);
    /**
     * The resolved core, once `instancePromise` settles. `trackTap` is the one public method that
     * cannot afford an `await` before it reads the world: the host's own press handler
     * navigates on the very next line (§4.6's mint/emit split).
     */
    private resolved?: any;

    constructor(opts?: {
        apiKey?: string;
        sender?: any;
        batchSize?: number;
        flushIntervalMs?: number;
        endpoint?: string;
        captureConsole?: boolean;
        debug?: boolean;
        store?: Store;   // either shape: the native path awaits
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

        debug.log("🌍 Running Native Telemetry");
        this.instancePromise = (async () => {
            // RN ships no WebCrypto; this already-declared dependency installs
            // crypto.getRandomValues, which the id path now draws from (#91). It is a
            // no-op wherever crypto already exists, which is why a failure here is only a
            // warning — off-device (SSR, tests) crypto is already there. If it genuinely
            // isn't, randomHex() throws with the reinstall instruction.
            try { await import("react-native-get-random-values"); }
            catch (err) { debug.warn("crypto.getRandomValues polyfill unavailable:", err); }

            const { Telemetry } = await import("./core/telemetry");
            const { nativeSender } = await import("./adapters/nativeSender");

            const { nativeStore } = await import("./adapters/native/store.native");
            const { DeviceInfoTrackerNative } = await import("./adapters/native/deviceInfo.native");
            const { NetworkInfoTrackerNative } = await import("./adapters/native/networkInfo.native");

            // device OS forms the device/session id suffix (ios|android)
            let platform: string | undefined;
            try {
                ({ Platform: { OS: platform } } = await import("react-native") as any);
            } catch { /* non-RN context (e.g. tests) — omit the suffix */ }

            const networkInfoTrackerNative = new NetworkInfoTrackerNative();
            const deviceInfoTrackerNative = new DeviceInfoTrackerNative();

            // One store, shared by the offline queue and core (#89) — so a consumer that
            // injects a store governs both, instead of the sender quietly keeping its own.
            const store = opts?.store ?? nativeStore();
            const sender = opts?.sender ?? nativeSender(opts?.endpoint, opts?.apiKey, store);

            const telemetry = new Telemetry({
                sender,
                batchSize: opts?.batchSize,
                flushIntervalMs: opts?.flushIntervalMs,
                endpoint: opts?.endpoint,
                platform,
                deviceInfoHandler: deviceInfoTrackerNative,
                networkInfoHandler: networkInfoTrackerNative,
                store,
                beforeSend: opts?.beforeSend,
                sessionSampleRate: opts?.sessionSampleRate,
                traceHostAllowlist: opts?.traceHostAllowlist,
                buildId: opts?.buildId,
            });

            // The offline queue drains through `sender.replayFailed()`, which the core
            // constructor above already called (#113). A second call here is what sent
            // every recovered batch twice.

            // Resume or start the session before the instance is visible (#92), so
            // session.started can never land behind the host app's first event.
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
            const { runtimeReadyAt } = await import("./adapters/native/runtimeReady.native")
                .catch((err: unknown) => {
                    debug.warn("Native runtime-ready module unavailable:", err);
                    return { runtimeReadyAt: async () => undefined };
                });
            const { seedRuntimeReady } = await import("./adapters/seedRuntimeReady");
            seedRuntimeReady(telemetry.views, runtimeReadyAt, "Native");

            await telemetry.resumeOrStartSession()
                .catch(err => debug.warn("Native session resume failed:", err));

            this.resolved = telemetry;
            return telemetry;
        })();

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

    // app_lifecycle on foreground/background via RN AppState (#30).
    //
    // §4.2: neither build rotates on a lifecycle transition — parity with web is reached by
    // *deleting* the old background→finalize / foreground→newSession pair, not by adding it
    // to web. Backgrounding still forces a flush, because the process is now most likely to
    // be killed and the queue only lives in memory.
    async attachAppLifecycle() {
        const { AppState } = await import("react-native") as any;
        const inst = await this.instancePromise;
        const { AppLifecycleEmitter } = await import("./adapters/appLifecycle");
        const emitter = new AppLifecycleEmitter(inst);
        // seed current state — a transition-only emitter, so this enqueues nothing
        emitter.onState(AppState.currentState === "active")
            .catch((e: any) => debug.warn("app lifecycle seed failed:", e));
        AppState.addEventListener("change", (next: string) => {
            const isActive = next === "active";
            // Awaited before the flush, not fired alongside it: backgrounding is a view
            // boundary (§4.5) and the `view` row it emits is exactly the row this flush
            // exists to rescue from the kill that usually follows.
            emitter.onState(isActive)
                .then(() => (isActive ? undefined : inst.flush()))
                .catch((e: any) => debug.warn("background flush failed:", e));
        });
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
        const { FrameDropTracker } = await import("./adapters/frameTracker");
        const inst = await this.instancePromise;
        const frameDropTracker = new FrameDropTracker(inst);
        return inst.trackFrameDrops(frameDropTracker);
    }

    async trackNetworkRequests() {
        const { NetworkTrackerNative } = await import("./adapters/native/interceptHttpNative.native");
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
        return inst.screens.startScreen(name);
    }

    async screenEnd(name: string) {
        const inst = await this.instancePromise;
        return inst.screens.endScreen(name);
    }

    async trackRoute(from: string, to: string) {
        const inst = await this.instancePromise;
        return inst.recordRouteChange(from, to);
    }

    // ---------- Interactions ----------

    /**
     * §4.6's native producer, explicit-only (#103). `interactionProps()` is gone with
     * `user.interaction` (#102): it sat on the consumer's **root** `<View>`, where
     * `PressEvent.nativeEvent.target` is a node tag number with no public API resolving it,
     * so it could not tell a tap on a button from a tap on padding and every row it emitted
     * was un-nameable. There is no role model to gate on and no DOM to derive from, so
     * anything auto-derived here would be either wrong or a PII leak.
     *
     * `name` is web's rung 1 — explicit author intent — so it ships **unnormalized and
     * uncapped**, and `ui.name_source` has exactly **two** values: `edge_action`, or `none`
     * for a blank name, whose `ui.target` is `unnamed`. **`surface` never appears**: it only
     * means something where role-less elements exist.
     *
     * ⚠ **The mint/emit split.** The row's `timestamp`, `view.id`, `view.name` and
     * `session.id` are snapshotted **here, synchronously**, because the host's press handler
     * navigates on the next line and the emit rides a promise. Stamping emit time would
     * attribute a navigating tap to **the view it opened**, inverting every "which screen
     * frustrates users" query. Before `instancePromise` settles there is no core to snapshot
     * from, so a tap that early falls back to emit-time identity — the launch view either
     * way.
     *
     * ⚠ **`ui.dead` is absent on every native row**, never `false`: with no DOM there is no
     * mutation signal, so any dead-click *rate* must filter to the web build.
     */
    async trackTap(name: string) {
        const at = Date.now();
        const named = typeof name === "string" && name.trim() !== "";
        const attrs = uiAttributes({
            type: "tap",
            target: named ? name : UI_UNNAMED,
            nameSource: named ? "edge_action" : "none",
            // No element model: nothing was resolved, so the tag names the platform rather
            // than inventing a `<button>` that does not exist. §4.6 types it never-null, as
            // it does the coordinates the builder floors at 0 — a `PressEvent` carries some,
            // but `trackTap(name)` deliberately takes none: the name is the whole contract.
            tag: "native",
            // Gated to named taps (§4.6): running rage over `unnamed` would not merely lose
            // information, it would invent a frustration event that never happened. Identity
            // is the name, which on native *is* the element — there is no node to key on.
            rage: named && this.tapRage.record(name, at),
        });
        // §6.2: **every** tap mints an interaction root, live carrier or not — a tap is a new
        // user action by definition, so the request it fires is its child and not the route
        // change's before it.
        const emit = (inst: any) =>
            inst.log("ui.interaction", { ...inst.trace.interactionSpan(at), ...attrs }, inst.snapshot(at));
        // Swallowed like every other capture path: the README's own example calls this
        // un-awaited from an `onPress`, and a RUM SDK must not be able to fault the host with
        // an unhandled rejection.
        return Promise.resolve(this.resolved ? emit(this.resolved) : this.instancePromise.then(emit))
            .catch((err: unknown) => debug.warn("Native ui.interaction failed:", err));
    }
}
