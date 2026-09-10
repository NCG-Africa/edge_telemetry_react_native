import { debug } from "./debug";
import { NavigationTracker } from "../adapters/navigationTracker";
import { ScreenTimingTracker } from "../adapters/screenTiming";
import { ViewManager, type ViewNameSource } from "../adapters/viewManager";
import { BreadcrumbBuffer } from "./breadcrumbs";
import { randomHex } from "./utils/uuid";
import type { Store } from "./store";
import { memoryStore } from "./memoryStore";
import { applyBeforeSend, type BeforeSend } from "./beforeSend";
import { version as PKG_VERSION } from "../../package.json";

export type { BeforeSend } from "./beforeSend";

// v3 wire contract constants
const SDK_PLATFORM = "react-native";   // framework identity; device OS lives in device.platform
const SDK_VERSION = PKG_VERSION;       // sdk.version follows the published package version
const SESSION_IDLE_MS = 30 * 60 * 1000; // rotate the session after 30 min of inactivity (iOS ADR-004)
// New in v4 (§4.2). Removing the process-death boundary lets a backgrounded app's
// http.request traffic hold one session open forever; this bounds length, not count.
const SESSION_MAX_MS = 4 * 60 * 60 * 1000;

/**
 * The in-memory queue's cap (§9.4). Drop-oldest, `app.crash` evicted last: a long
 * offline period on an unbounded queue grows inside the host app's heap, and evicting
 * crashes first would make the crash-free rate read *better* the worse the network is.
 */
const QUEUE_MAX_EVENTS = 500;

/** `sdk.drop_reason` (§11). `rejected` has no producer until 4xx-drops-the-batch lands (#113). */
export type DropReason = "queue_full" | "store_full" | "rejected";

/**
 * Which row to evict to get back under a cap: the oldest non-crash, or — when every
 * row is a crash — the oldest, because growing past the cap is not an option either.
 *
 * Shared with the offline store (`adapters/failedEvents.ts`) so the in-memory queue and
 * the disk queue can never disagree about what survives.
 *
 * ponytail: O(n) scan per eviction, n <= 500. Track the first non-crash index if a
 * profile ever shows this on a hot path.
 */
/** An event's `event.sequence`, or -1 before `enqueue()` has stamped one. */
const seqOf = (e: TelemetryEvent): number => e.attributes?.['event.sequence'] ?? -1;

export function evictIndex(events: TelemetryEvent[]): number {
    const i = events.findIndex(e => e.eventName !== "app.crash");
    return i === -1 ? 0 : i;
}

/** Store key for the self-minted, persisted `device.id` (#91). */
export const DEVICE_ID_KEY = "telemetry_device_id";
/** Store key for the resumable session record (#92). */
export const SESSION_KEY = "telemetry_session";

/** `session.reason` domains: 3 on session.started, the last 2 on session.finalized (§4.1/§4.2). */
export type SessionReason = "launch" | "idle" | "max_duration";
export type SessionEndReason = Exclude<SessionReason, "launch">;

/**
 * What survives process death, tab close, hard reload and bfcache restore (§4.2).
 * On web the Store is `localStorage`, so this record is browser-wide and shared
 * across tabs — intended, not a leak.
 */
type PersistedSession = {
    id: string;
    start: number;
    lastActivity: number;
    sequence: number;
    // Per-session, per-event ordinal (§2.4). Persisted for the same reason `sequence` is:
    // a resumed session restarting at 0 emits duplicate (session.id, event.sequence) pairs,
    // which is exactly the key the backend's dedup index is built on.
    eventSequence: number;
    eventCount: number;
    errorCount: number;
    // The sticky sample decision and the rate it was rolled at (§3.6). Both travel with
    // the session, because a resume is not a rotation — re-rolling on relaunch produces
    // a half-sampled session, and shipping the *current* config rate on a session rolled
    // at the old one makes every extrapolation off it wrong.
    sampled: boolean;
    sampleRate: number;
};

/** What hydration decided, so the emitting half stays free of storage concerns. */
type SessionHydration =
    | { kind: "resumed" }                                   // inside the idle window: no session.started (§4.1)
    | { kind: "nothing" }                                   // miss or unavailable — storage told us nothing
    | { kind: "expired"; reason: SessionEndReason };        // adopted, now owed a finalize + a fresh session
/** The collector caps `user.id` at 255; truncate at source rather than be rejected (§3.2). */
const USER_ID_MAX = 255;

// Names the backend routes. Anything else is remapped to `custom_event` with the
// original name carried as `event.name`. Includes metric names so the metric path
// (slice: native metrics) isn't remapped.
const ALLOWED_NAMES = new Set<string>([
    "session.started", "session.finalized", "app_lifecycle", "page_load", "navigation",
    "screen.duration", "http.request", "user.interaction", "network_change",
    "user.profile.update", "custom_event", "app.crash", "view",
    "resource_timing", "frame_render_time", "memory_usage", "long_task",
    "LCP", "FCP", "CLS", "INP", "TTFB",
]);

// Events carry `eventName`; metrics carry `metricName` + numeric `value` (v3 §"Event vs Metric").
// Kept as one loose shape (not a strict union) so callers can read `.eventName` without narrowing;
// the emit helpers (log / logMetric) set the right fields, and JSON.stringify drops the undefined ones.
export type TelemetryEvent = {
    type: 'event' | 'metric';
    eventName?: string;
    metricName?: string;
    value?: number;
    timestamp: string;          // ISO 8601 (v3 wire contract) — never ms epoch
    attributes?: Record<string, any>;
};

export interface Sender {
    send(events: TelemetryEvent[]): Promise<void>;
    /**
     * Persist a batch that could not be sent. Returns how many rows the offline store's
     * cap cost, so core can book them as `sdk.drop_reason = "store_full"` (§9.4) — the
     * counter lives on the Context block, which only core assembles. `void` is still a
     * valid return: a consumer's own sender is not obliged to have a cap.
     */
    onFailure?(events: TelemetryEvent[]): Promise<number | void>;
    replayFailed?(): Promise<void>;
}



export interface CrashHandlerOptions {
    captureConsole?: boolean;   // funnel console.error/warn into app.crash (default on, opt-out)
}

export interface CrashHandler {
    attach(options?: CrashHandlerOptions): Promise<void>;
}
export interface NetworkInfo {
    type?: string;        // "wifi", "cellular", "ethernet", "unknown", etc.
    is_connected?: boolean;
}

export interface WebExtraNetworkInfo {
    type?: string;
    isConnected?: boolean;
    downlink?: number;      // Mbps estimate
    effectiveType?: string; // "4g", "3g", etc.
}

export interface NetworkInfoHandler {
    start(telemetry: Telemetry): Promise<NetworkInfo>;
    collect(): Promise<NetworkInfo>;
}

export interface DeviceInfoHandler {
    start(telemetry: Telemetry): Promise<void>;
    collect(): Promise<DeviceInfo>;
}
export interface FrameDropsHandler {
    start(): Promise<void>;
}

export interface NetworkHandler {
    start(): Promise<void>;
}

export interface MemoryHandler {
    recordMemoryUsage(): Promise<void>;
}

export interface NavigationHandler {
    start(): Promise<void>;
}


export interface DeviceInfo {
    app: {
        name: string;
        version: string;
        build_number?: string;
        package_name?: string;
    };
    device: {
        // No `id` here (#91): core self-mints and persists device.id, and stamps it onto the
        // Context block *after* this block is flattened — an adapter-set id would be dead.
        platform: string;
        platform_version?: string;
        model?: string;
        manufacturer?: string;
        brand?: string;
        android_sdk?: string;
        android_release?: string;
        fingerprint?: string;
        hardware?: string;
        product?: string;
        ios_system_name?: string;
        iosDeviceName?: string;
    };
}

export interface UserProfile {
    userId?: string;
    fullName?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    avatar?: string;
    customAttributes?: Record<string, any>;
    createdAt?: number;
    updatedAt?: number;
}


type Opts = {
    sender?: Sender;
    batchSize?: number;
    flushIntervalMs?: number;
    endpoint?: string;
    sessionId?: string;
    userId?: string;
    sdkVersion?: string;
    platform?: string;          // device OS (ios|android|web); forms the device/session id suffix
    deviceInfoHandler?: DeviceInfoHandler;
    networkInfoHandler?: NetworkInfoHandler;
    store?: Store;              // persisted state port (#89); defaulted per build by the entry
    // Constructor-only (§3.6). A runtime setter leaves a window between init and
    // registration where session.started, the launch root and the early http.requests
    // all land — that window is the reason, and it is not negotiable.
    beforeSend?: BeforeSend;
    sessionSampleRate?: number; // 0.0-1.0, sticky per session; default 1 (send everything)
    // The deprecated native screen feeds — `navigation` and `screen.duration` (§4.11) — on
    // the ROUTE path. Defaults on, because shared core's v3 behaviour *is* the native one;
    // the web entry opts out, having never emitted `screen.duration` at all. It does not
    // silence web's own history path, which still emits `navigation`. Config from the entry,
    // which is the platform split point — not a branch inside shared code.
    deprecatedScreenFeeds?: boolean;
};

/**
 * A bad rate must not silently mute a deployment: `Math.random() < NaN` is always false,
 * so an unvalidated `undefined`-shaped value would sample every session out and look
 * exactly like a dead collector. Out of range means "the consumer meant something", and
 * the only safe reading of that is 1.
 */
function normalizeSampleRate(rate: number | undefined): number {
    if (rate === undefined) return 1;
    // Number.isFinite is false for a non-number too, so this covers a JS caller's "0.5".
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
        debug.warn(`Telemetry: sessionSampleRate must be a number in [0,1] — got ${rate}; using 1`);
        return 1;
    }
    return rate;
}

/**
 * Telemetry core: queueing, batching, retries, auto-replay and session/user management.
 * Keeps the external API you already use: log(name, data?), flush(), shutdown().
 */
export class Telemetry {
    private queue: TelemetryEvent[] = [];
    private sender?: Sender;
    private batchSize: number;
    private flushIntervalMs: number;
    private intervalId: any = null;
    private endpoint?: string;
    private crashHandler?: CrashHandler;
    private navigationTracker?: NavigationTracker;
    // single screen-tracking API (timed); used by the native screenStart/screenEnd
    public screens: ScreenTimingTracker;
    // The View entity (§4.5, #96): view.id/view.name on every row, the `view` event at each
    // of the four exit boundaries, and the name ladder. Public because the route, lifecycle
    // and interaction adapters all feed it.
    public readonly views: ViewManager;
    private readonly deprecatedScreenFeeds: boolean;
    // last-known screen; best-effort context for user.interaction taps (#33)
    public currentScreen?: string;

    private networkInfoHandler: NetworkInfoHandler;
    private deviceInfoHandler: DeviceInfoHandler;

    // Persisted state (#89). The entry injects webStore()/nativeStore(); shared core
    // never imports either. Both entries always inject, so the fallback below only
    // covers a direct `new Telemetry()` — it reports `unavailable`, putting such a
    // caller on the same branch as incognito rather than crashing.
    // Public because it is this seam's only observation point until v4's device.id,
    // session resume, sticky sample rate and capped offline store read it.
    public readonly store: Store;

    private frameDropsHandler?: FrameDropsHandler;
    private networkHandler?: NetworkHandler;
    private memoryHandler?: MemoryHandler;
    private navigationHandler?: NavigationHandler;


    // session / user state
    // Consumer-owned (#91). No anonymous mint: absent until the host app supplies one,
    // so COUNT(DISTINCT user.id) is known-user reach and not a visitor count.
    private userId?: string = undefined;
    // SDK-owned, persisted, uninstall-scoped, never rotates — not on login, not on logout.
    private deviceIdEphemeral = false;
    private deviceIdPromise?: Promise<string>;
    private userProfile?: UserProfile = undefined;
    private sessionId: string;
    private sessionStart: number;
    private sdkVersion: string;
    private platform?: string;
    private eventCount = 0;
    // last-20 action trail, attached to app.crash as crash.breadcrumbs (#28)
    private breadcrumbs = new BreadcrumbBuffer(20);
    // session lifecycle (#29)
    private lastActivity?: number;       // last non-session event time; drives 30-min idle rotation
    private sessionSequence = 0;         // increments per acknowledged (2xx) batch
    private eventSequence = 0;           // event.sequence — per-session ordinal, stamped at enqueue
    private sessionEventCount = 0;       // events this session (journey summary)
    private errorCount = 0;              // app.crash count this session (sdk.error_count)

    // Sampling and scrubbing (#93, §3.6). `configuredSampleRate` is what the constructor
    // was given and what every rotation re-rolls at; `sampleRate` is what *this* session
    // was rolled at and what ships as session.sample_rate, so a consumer retuning
    // mid-quarter can't retroactively mis-scale a session already in flight.
    private readonly configuredSampleRate: number;
    private sampleRate: number;
    private sampled: boolean;
    private readonly beforeSend?: BeforeSend;
    private hookDropped = 0;             // sdk.hook_dropped — the hook working
    private hookFailed = 0;              // sdk.hook_failed  — the hook broken

    // Drop accounting (§3.7). Process-lifetime and monotonic — deliberately not reset by a
    // rotation, so "how much did this install lose" is one subtraction and not a sum.
    // These are lossy about their own loss by construction: they only arrive if a *later*
    // event gets through, so the tab that closes and never returns reports nothing.
    // `event.sequence`'s gaps are what actually covers that.
    private eventsDropped = 0;
    private dropReason?: DropReason;
    // Highest `event.sequence` the crash path has already written to the offline store, so a
    // second crash persists only the rows the first one did not. -1 means "nothing yet".
    private crashPersistedThrough = -1;

    constructor(opts?: Opts) {
        this.sender = opts?.sender;
        // Android's numbers, deliberately (§9.4). These SDKs feed shared tables, so a
        // per-SDK cadence makes cross-platform arrival comparisons quietly wrong. POSTs get
        // ~25x larger and 3x rarer; the collector clears a 50-event batch ~20x over (§2.3).
        this.batchSize = opts?.batchSize ?? 50;
        this.flushIntervalMs = opts?.flushIntervalMs ?? 30000;
        this.endpoint = opts?.endpoint;
        this.platform = opts?.platform;   // set before id generation (suffix source)
        this.store = opts?.store ?? memoryStore({ unavailable: true });
        this.beforeSend = opts?.beforeSend;
        this.configuredSampleRate = normalizeSampleRate(opts?.sessionSampleRate);
        this.sampleRate = this.configuredSampleRate;
        // Rolled here so a bare `new Telemetry()` — no resumeOrStartSession() — is decided
        // too. hydrateSession() overwrites it when a durable record says otherwise.
        this.sampled = this.rollSample();

        // start a session
        this.sessionId = opts?.sessionId ?? this.generateSessionId();
        if (opts?.userId) this.setUserId(opts.userId);
        this.sessionStart = Date.now();
        this.sdkVersion = opts?.sdkVersion ?? SDK_VERSION;

        // auto replay if supported
        if (this.sender?.replayFailed) {
            // don't block constructor; best-effort
            this.sender.replayFailed().catch((err: any) => {
                debug.warn("Telemetry replay failed Telemetry class:", err);
            });
        }

        if (this.flushIntervalMs > 0) {
            this.intervalId = setInterval(() => this.flush().catch(() => { }), this.flushIntervalMs);
        }

        this.navigationTracker = new NavigationTracker(this);
        this.screens = new ScreenTimingTracker(this);
        this.deprecatedScreenFeeds = opts?.deprecatedScreenFeeds ?? true;
        // The initial view opens here, at SDK init — so no row can ever precede a view (§4.5).
        this.views = new ViewManager(this);

        this.deviceInfoHandler = opts?.deviceInfoHandler ?? {
            start: async () => Promise.resolve(),
            collect: async () => Promise.resolve({
                app: { name: '', version: '' },
                device: { platform: '' }
            })
        };
        this.networkInfoHandler = opts?.networkInfoHandler ?? {
            start: async () => Promise.resolve({}),
            collect: async () => Promise.resolve({})
        };

    }

    // ---------- Session & User APIs ----------

    public trackErrors(crashHandler: CrashHandler, options?: CrashHandlerOptions) {
        this.crashHandler = crashHandler;
        void crashHandler.attach(options).catch((err) => {
            debug.warn("Telemetry crashHandler attach failed:", err);
        });
    }

    getDeviceInfo(deviceInfoHandler: DeviceInfoHandler) {
        this.deviceInfoHandler = deviceInfoHandler;
        void deviceInfoHandler.start(this).catch((err) => {
            debug.warn("Telemetry deviceInfo tracking start failed:", err);
        });
    }

    getNetworkInfo(networkInfoHandler: NetworkInfoHandler) {
        this.networkInfoHandler = networkInfoHandler;
        void networkInfoHandler.start(this).catch((err) => {
            debug.warn("Telemetry networkInfoHandler start failed:", err);
        });
    }

    public trackFrameDrops(frameDropsHandler: FrameDropsHandler) {
        this.frameDropsHandler = frameDropsHandler;
        void frameDropsHandler.start().catch((err) => {
            debug.warn("Telemetry frameDropsHandler start failed:", err);
        });
    }

    public trackNetworkRequests(networkHandler: NetworkHandler) {
        this.networkHandler = networkHandler;
        void networkHandler.start().catch((err) => {
            debug.warn("Telemetry networkHandler start failed:", err);
        });
    }

    public trackMemoryUsage(memoryHandler: MemoryHandler) {
        this.memoryHandler = memoryHandler;
        void memoryHandler.recordMemoryUsage().catch((err) => {
            debug.warn("Telemetry memoryHandler recordMemoryUsage failed:", err);
        });
    }

    public autoTrackNavigation(navigationHandler?: NavigationHandler) {
        this.navigationHandler = navigationHandler;
        void navigationHandler?.start().catch((err) => {
            debug.warn("Telemetry navigationHandler start failed:", err);
        });
    }


    /**
     * The per-session sample roll (§3.6). Never per-event: per-event sampling punches
     * holes that desynchronise the per-view counters by a random factor per view.
     *
     * `Math.random()` is deliberate here where `randomHex` refuses it — this decides one
     * boolean that dies with the session, not an id that persists forever, and a biased
     * PRNG costs a fraction of a percent of sample accuracy rather than a permanent
     * identity collision.
     */
    private rollSample(): boolean {
        return Math.random() < this.sampleRate;
    }

    private generateSessionId(): string {
        const base = `session_${Date.now()}_${randomHex(16)}`;
        // §3.3 suffixes session.id with ios|android only — the web build gains `_web` in v4,
        // not here. device.id is suffixed on all three, so the rule can't just be `platform`.
        return this.platform === "ios" || this.platform === "android"
            ? `${base}_${this.platform}`
            : base;
    }

    public setSessionId(id: string) {
        this.sessionId = id;
        this.sessionStart = Date.now();
    }

    public getSessionId(): string {
        return this.sessionId;
    }

    /** Collector endpoint, so fetch/XHR adapters can skip self-capturing the SDK's own POST. */
    public getEndpoint(): string | undefined {
        return this.endpoint;
    }

    // ---------- Session lifecycle (#29) ----------

    /**
     * The entry's one call at init (§4.2): resume the durable session when the gap is
     * inside the idle window, otherwise close the stale one out and start fresh.
     *
     * Process death, tab close, hard reload and bfcache restore all land here, and all
     * four **resume** — which is why a resumed session must not re-emit `session.started`
     * (§4.1), or `COUNT(session.started)` stops equalling session count.
     */
    public async resumeOrStartSession() {
        const decision = await this.hydrateSession();
        if (decision.kind === "resumed") return;
        // Expired: hydration adopted the old id/start so the finalize ships under them.
        if (decision.kind === "expired") { await this.rotateSession(decision.reason); return; }

        // Storage told us nothing. At init that means launch. On a bfcache restore this method
        // runs a second time with a session already going — storage having nothing to say is no
        // reason to discard it and re-announce a session that never ended. Just re-check the
        // boundaries, which is the whole point of re-running after a long freeze.
        if (this.lastActivity === undefined) { await this.startSession("launch"); return; }
        const reason = this.expiryReason(Date.now());
        if (reason) await this.rotateSession(reason);
    }

    /**
     * Read the durable record and adopt it. Adoption happens even when the session has
     * expired: `session.finalized` has to ship under the *old* `session.id` and
     * `session.start_time` before the fresh one takes over.
     */
    private async hydrateSession(): Promise<SessionHydration> {
        const read = await this.store.get(SESSION_KEY);
        // `unavailable` is not `miss` — incognito, a partitioned iframe, ITP eviction or a full
        // disk means this process can never resume and can never be resumed FROM, so every
        // launch mints a session and COUNT(session.started) over-counts. There is no
        // `session.id_ephemeral` on the contract to say so, and inventing one needs backend
        // sign-off — but the same store failed the device.id round-trip, so every event from
        // this population already carries `device.id_ephemeral: true`. Filter on that.
        if (read.status === "unavailable") {
            debug.warn("Telemetry: session storage unavailable — this session cannot be resumed");
            return { kind: "nothing" };
        }
        if (read.status === "miss") return { kind: "nothing" };

        let saved: Partial<PersistedSession>;
        try { saved = JSON.parse(read.value); } catch { return { kind: "nothing" }; }
        // A record we can't trust is not a session to resume; mint rather than guess.
        if (typeof saved?.id !== "string"
            || typeof saved.start !== "number"
            || typeof saved.lastActivity !== "number") return { kind: "nothing" };

        this.sessionId = saved.id;
        this.sessionStart = saved.start;
        this.lastActivity = saved.lastActivity;
        this.sessionSequence = saved.sequence ?? 0;
        this.eventSequence = saved.eventSequence ?? 0;
        this.sessionEventCount = saved.eventCount ?? 0;
        this.errorCount = saved.errorCount ?? 0;
        // A resume is not a rotation: the decision and the rate it was rolled at are
        // adopted as-is, so a relaunch can't half-sample a session. A record written
        // before this field existed reads as `undefined` and keeps the fresh roll.
        // The rate is stamped on every row of the resumed session, and on web the record is
        // browser-wide localStorage — so an out-of-range value would ship as a divisor and
        // silently mis-scale every count taken off it. A record we can't trust here loses
        // its decision too, and the fresh constructor roll stands.
        if (typeof saved.sampled === "boolean"
            && Number.isFinite(saved.sampleRate) && saved.sampleRate! >= 0 && saved.sampleRate! <= 1) {
            this.sampled = saved.sampled;
            this.sampleRate = saved.sampleRate!;
        }

        const reason = this.expiryReason(Date.now());
        return reason ? { kind: "expired", reason } : { kind: "resumed" };
    }

    /**
     * Which boundary, if any, the current session has crossed. Idle is checked first:
     * when a long session has also gone quiet, the reason it ended is that the user left.
     *
     * Inert until `lastActivity` is set, so a bare `new Telemetry()` that never started a
     * session never rotates one.
     */
    private expiryReason(now: number): SessionEndReason | undefined {
        if (this.lastActivity === undefined) return undefined;
        // Both boundaries are strict: a session sitting exactly on one has not crossed it.
        if (now - this.lastActivity > SESSION_IDLE_MS) return "idle";
        if (now - this.sessionStart > SESSION_MAX_MS) return "max_duration";
        return undefined;
    }

    /**
     * Write the session through the `Store` so the next process can resume it.
     *
     * ponytail: one write per event. Web's is a synchronous `localStorage` write; native's
     * is an AsyncStorage round-trip — debounce here if it ever shows up in a trace.
     */
    private async persistSession() {
        const record: PersistedSession = {
            id: this.sessionId,
            start: this.sessionStart,
            lastActivity: this.lastActivity ?? this.sessionStart,
            sequence: this.sessionSequence,
            eventSequence: this.eventSequence,
            eventCount: this.sessionEventCount,
            errorCount: this.errorCount,
            sampled: this.sampled,
            sampleRate: this.sampleRate,
        };
        const write = await this.store.set(SESSION_KEY, JSON.stringify(record));
        // Same first-class `unavailable` path as the read: nothing to retry and nothing to
        // throw, but it must not read as a successful write. See hydrateSession().
        if (write.status === "unavailable") debug.log("Telemetry: session not persisted (store unavailable)");
    }

    /** Emit session.started for the current session. */
    public async startSession(reason: SessionReason) {
        this.lastActivity = Date.now();
        await this.persistSession();   // durable before it is announced
        await this.log("session.started", { "session.reason": reason });
    }

    /**
     * Finalize the current session: journey summary + sdk.error_count, then an immediate flush.
     *
     * The backend discards `duration_ms` and `event_count` and derives both (§4.2) — they
     * stay on the wire because the event survives as the carrier for `session.reason` and
     * `sdk.error_count`, neither of which is derivable. Duration is stamped from
     * `lastActivity`, never `now`: a lazily-detected rotation must report 2 minutes of use,
     * not the 6 idle hours that followed it.
     */
    public async finalizeSession(reason: SessionEndReason) {
        await this.log("session.finalized", {
            "session.duration_ms": Math.max(0, (this.lastActivity ?? this.sessionStart) - this.sessionStart),
            "session.event_count": this.sessionEventCount,
            "sdk.error_count": this.errorCount,
            "session.reason": reason,
        });
        await this.flush();
    }

    /** Begin a fresh session: new id/start, reset per-session counters, emit session.started. */
    public async newSession(reason: SessionReason) {
        this.sessionId = this.generateSessionId();
        this.sessionStart = Date.now();
        this.sessionSequence = 0;
        this.eventSequence = 0;   // the ordinal is per session, and this is a new one
        this.crashPersistedThrough = -1;   // the watermark is an event.sequence, so it resets with it
        this.sessionEventCount = 0;
        this.errorCount = 0;
        // Re-rolled at the *configured* rate, not the retired session's — the previous
        // session may have been resumed from a record written under an older config.
        this.sampleRate = this.configuredSampleRate;
        this.sampled = this.rollSample();
        // After the new session.id is in place and before the first row of it is emitted:
        // `view.id` never spans a `session.id` (§4.5). rotateSession() has already emitted
        // the departing view's `view` event under the *old* id.
        this.views.beginView("session_rotation");
        await this.startSession(reason);
    }

    /** Boundary rotation: finalize the old session then start a fresh one (the pair). */
    public async rotateSession(reason: SessionEndReason) {
        // The session-rotation view boundary (§4.5), emitted first so the `view` row lands
        // under the session it belongs to. newSession() mints the successor.
        await this.views.endView();
        await this.finalizeSession(reason);
        await this.newSession(reason);
    }

    /** Truncated at source (§3.2): the collector caps at 255 and we must not be the one over. */
    public setUserId(id: string) {
        this.userId = id ? id.slice(0, USER_ID_MAX) : undefined;
    }

    public getUserId(): string | undefined {
        return this.userId;
    }

    /**
     * The SDK-owned `device.id` (§3.2/§3.3): self-minted, written through the `Store`,
     * uninstall-scoped, stable across process restarts, and never rotated by login,
     * logout or a profile clear.
     *
     * The platform suffix is the entry's (ios|android|web), not the device-info adapter's:
     * this id is persisted forever, so it must not depend on a call that can throw on first run.
     *
     * `getUniqueId()` is deliberately not used — it already carries two lifetimes on RN
     * alone (ANDROID_ID survives reinstall, identifierForVendor does not), so one identity
     * column would mean two things.
     *
     * When the Store reports `unavailable` — incognito, a partitioned iframe, ITP
     * eviction, a full disk — the id lives for one process only and `device.id_ephemeral`
     * rides the Context block to say so, because that population is otherwise
     * indistinguishable from real installs and reads as traffic growth.
     */
    private async getDeviceId(): Promise<string> {
        this.deviceIdPromise ??= (async () => {
            const read = await this.store.get(DEVICE_ID_KEY);
            if (read.status === "hit") return read.value;
            const suffix = this.platform ? `_${this.platform}` : "";
            const id = `device_${Date.now()}_${randomHex(16)}${suffix}`;
            const write = await this.store.set(DEVICE_ID_KEY, id);
            // Either end of the round-trip failing means this id never comes back.
            this.deviceIdEphemeral = read.status === "unavailable" || write.status === "unavailable";
            return id;
        })();
        return this.deviceIdPromise;
    }

    // ---------- User Profile Management ----------

    /**
     * Set complete user profile information
     */
    public setUserProfile(profile: Partial<UserProfile>): void {
        const now = Date.now();
        
        // If this is a new profile or userId changed, set createdAt
        const isNewProfile = !this.userProfile || (profile.userId && profile.userId !== this.userProfile.userId);
        
        this.userProfile = {
            ...this.userProfile,
            ...profile,
            updatedAt: now,
            ...(isNewProfile && { createdAt: now })
        };

        // Update userId if provided in profile (truncated at source, §3.2)
        if (profile.userId) {
            this.setUserId(profile.userId);
            this.userProfile.userId = this.userId;
        } else if (this.userProfile && !this.userProfile.userId) {
            // Mirror the current id into the profile — undefined while still anonymous
            this.userProfile.userId = this.userId;
        }

        debug.log("Telemetry: User profile updated", this.userProfile);
    }

    /**
     * EdgeRum-style identify(): attach host-app identity (name/email/phone) to subsequent
     * events and emit one `user.profile.update`. The SDK-owned anonymous `user.id` is
     * preserved — identify never changes it. (#31)
     */
    public async identify(profile: {
        name?: string;
        email?: string;
        phone?: string;
        avatar?: string;
        customAttributes?: Record<string, any>;
    }) {
        this.setUserProfile({
            fullName: profile.name,
            email: profile.email,
            phone: profile.phone,
            avatar: profile.avatar,
            customAttributes: profile.customAttributes,
        });
        await this.log("user.profile.update", {});
    }

    /**
     * Set user details with individual parameters
     */
    public setUserDetails(details: {
        fullName?: string;
        firstName?: string;
        lastName?: string;
        email?: string;
        phone?: string;
        avatar?: string;
        customAttributes?: Record<string, any>;
    }): void {
        this.setUserProfile(details);
    }

    /**
     * Update specific user profile fields
     */
    public updateUserProfile(updates: Partial<UserProfile>): void {
        if (!this.userProfile) {
            // If no profile exists, create one
            this.setUserProfile(updates);
            return;
        }

        this.userProfile = {
            ...this.userProfile,
            ...updates,
            updatedAt: Date.now()
        };

        debug.log("Telemetry: User profile updated", this.userProfile);
    }

    /**
     * Get current user profile
     */
    public getUserProfile(): UserProfile | undefined {
        return this.userProfile;
    }

    /**
     * Clear user profile data
     */
    public clearUserProfile(): void {
        this.userProfile = undefined;
        this.userId = undefined;   // consumer-owned (§3.2): cleared here, unlike device.id
        debug.log("Telemetry: User profile cleared");
    }

    /**
     * Set user name (convenience method)
     */
    public setUserName(fullName: string, firstName?: string, lastName?: string): void {
        this.setUserProfile({
            fullName,
            firstName,
            lastName
        });
    }

    /**
     * Set user contact info (convenience method)
     */
    public setUserContact(email?: string, phone?: string): void {
        this.setUserProfile({
            email,
            phone
        });
    }

    // ---------- Logging APIs ----------

    /**
     * Log a named event. Keeps existing signature compatibility.
     * Automatically attaches userId and sessionId to every queued event.
     */
    async log(name: string, data?: Record<string, any>) {
        this.eventCount++;
        let activity = false;
        let crashed = false;

        // Session activity and the two boundaries — 30-min idle and the 4-hour cap (§4.2).
        // Session events don't count as activity (they're emitted *by* the lifecycle), so
        // they never re-trigger a rotation.
        // `view` joins the session events here: it is emitted *by* a boundary, from inside
        // rotateSession() among others, so letting it re-enter the expiry check would recurse
        // forever on an already-expired session. It is bookkeeping, not user activity.
        if (!name.startsWith('session.') && name !== 'view') {
            const now = Date.now();
            const reason = this.expiryReason(now);
            if (reason) await this.rotateSession(reason);
            this.lastActivity = now;
            this.sessionEventCount++;
            if (name === 'app.crash') this.errorCount++;
            activity = true;
        }

        // A sampled-out session sends nothing at all — not a skeleton record, and
        // crashes are no exception (§3.6): 100% of crashes over 10% of sessions makes
        // the unfiltered crash-free query read 10x too high with no WHERE to repair it.
        // The boundary bookkeeping above still runs, so the rotation that re-rolls the
        // decision still happens on schedule.
        if (this.sampled) {
            // v3 allowlist: unknown names ship as custom_event, original kept as event.name
            const isAllowed = ALLOWED_NAMES.has(name);
            const eventName = isAllowed ? name : 'custom_event';

            const attributes = await this.collectContext(data);
            if (!isAllowed) attributes['event.name'] = name;

            // app.crash carries the trail of prior actions; other events extend the trail.
            if (eventName === 'app.crash') {
                attributes['crash.breadcrumbs'] = this.breadcrumbs.toJSON();
                crashed = true;
            } else {
                this.breadcrumbs.add({ name: eventName, timestamp: new Date().toISOString() });
            }

            // §4.5's three counters, booked against the view this row is pinned to.
            // `view.error_count` is a closed enumeration — crashes only, not failed requests
            // and not console.warn — and `view.request_count` counts every http.request,
            // failures included; the adapters already exclude the collector's own POST.
            if (eventName === 'app.crash') this.views.count('error');
            else if (eventName === 'user.interaction') this.views.count('action');
            else if (eventName === 'http.request') this.views.count('request');

            this.enqueue({
                type: 'event',
                eventName,
                timestamp: new Date().toISOString(),
                attributes,
            });

            debug.log("Telemetry queued event:", name, "Queue size:", this.queue.length);
            debug.log("Event attributes:", attributes);
        }

        // After the enqueue, never before it: the durable record is for the *next* process,
        // and on native this is an AsyncStorage round-trip that must not sit in front of the
        // event it describes.
        if (activity) await this.persistSession();

        // A crash is the row the process may not survive to send twice, so it does not wait
        // for the batch to fill. Awaited, unlike the batch-full flush: `app.crash` is emitted
        // from a dying process's teardown, and a fire-and-forget send there is a send that
        // never happens.
        if (crashed) {
            await this.flushCrash();
        } else if (this.queue.length >= this.batchSize) {
            void this.flush();
        }
    }

    /**
     * The crash path (§2 / §9.4): persist the whole queue, then send **one** batch reordered
     * so the crash rides in it. Not a drain — a dying process gets one round trip.
     *
     * ⚠ The web/native asymmetry is real and is not fixed here. On web the `Store` is
     * synchronous `localStorage`, so the persist has *landed* by the time the next line runs
     * and the loss window closes. On native it is an AsyncStorage round-trip that a SIGKILL
     * can outrun, so the window only narrows. Awaiting harder does not change that; the
     * asymmetry is the `Store` port's whole point (`core/store.ts`).
     *
     * The persisted copy is a safety copy, not a handoff: the queue is left intact, because
     * most `app.crash` rows are non-fatal (a caught error, or a `console.error` under the
     * default `captureConsole`) and the process usually lives on. A successful send therefore
     * leaves a duplicate on disk to replay next launch — which is what `event.sequence` and
     * the backend's `(session_id, event_sequence)` dedup exist for (§2.4).
     *
     * *One* duplicate. Each row is written at most once by this path, watermarked on
     * `event.sequence`: `captureConsole` is on by default, so a chatty app crash-flushes
     * often, and re-persisting the whole queue each time would fill the store with copies of
     * its own backlog and book `store_full` drops that are not loss — corrupting the very
     * counter this change adds.
     */
    private async flushCrash() {
        if (!this.sender || this.queue.length === 0) return;

        // Move crashes to the front, relative order intact: at batchSize 50 a crash enqueued
        // behind 49 older events would otherwise miss the only batch this process gets.
        const isCrash = (e: TelemetryEvent) => e.eventName === 'app.crash';
        this.queue = [...this.queue.filter(isCrash), ...this.queue.filter(e => !isCrash(e))];

        const pending = this.queue.filter(e => seqOf(e) > this.crashPersistedThrough);
        if (pending.length > 0 && this.sender.onFailure) {
            try {
                this.recordDrop("store_full", await this.sender.onFailure(pending));
                // Advanced only on a write that returned: a throw leaves the watermark where
                // it was, so the next crash retries these rows rather than abandoning them.
                this.crashPersistedThrough = Math.max(this.crashPersistedThrough, ...pending.map(seqOf));
            } catch (err) {
                debug.warn("Telemetry: crash-path persist failed:", err);
            }
        }

        // Spliced *before* the send, not after: both the interval and the batch-full trigger
        // fire flush() unawaited, so a concurrent flush() splices this same front — and a
        // post-send splice would then delete rows this batch never carried, silently and
        // without booking them. Sent directly rather than through flush() because the rows
        // are already on disk and flush()'s failure path would persist them a second time.
        const batch = this.queue.splice(0, this.batchSize);
        try {
            await this.sender.send(batch);
            await this.ackBatch();
        } catch (err) {
            // Requeue only what the store does not already hold — the rest is safe on disk
            // and requeueing it would send it twice for no gain.
            const unsaved = batch.filter(e => seqOf(e) > this.crashPersistedThrough);
            if (unsaved.length > 0) this.queue.unshift(...unsaved);
            debug.warn("Telemetry: crash-path send failed:", err);
        }
    }

    /**
     * Build the v3 Context block that rides on every event AND metric: the flattened
     * device/network snapshot, the caller's data, identity + session + sdk fields, and the
     * user profile. Shared by log() and logMetric() so both carry the identical iOS-clean set.
     */
    private async collectContext(data?: Record<string, any>): Promise<Record<string, any>> {
        let deviceInfo: Record<string, any> = {};
        let networkInfo: Record<string, any> = {};

        try {
            deviceInfo = (await this.deviceInfoHandler?.collect()) || {};
        } catch (err) {
            debug.warn("Telemetry: failed to fetch device info", err);
        }

        try {
            networkInfo = (await this.networkInfoHandler?.collect()) || {};
        } catch (err) {
            debug.warn("Telemetry: failed to fetch network info", err);
        }

        // Mint/read before assembling. device.id is persisted forever, so its suffix comes
        // from the entry-supplied platform and never from collect(), which can throw.
        const deviceId = await this.getDeviceId();

        const attributes: Record<string, any> = {
            // deviceInfo already namespaces its own keys (app.*, device.*) — flatten flat
            ...this.flattenWithPrefix('', deviceInfo),
            ...this.flattenWithPrefix('network', networkInfo),
            ...this.flattenWithPrefix('', data || {}),
            // Identity keys land after caller data: `data` may override app./device./network.*
            // but must never override these (§3.3).
            'device.id': deviceId,
            ...(this.deviceIdEphemeral ? { 'device.id_ephemeral': true } : {}),
            // Omitted entirely on anonymous traffic (§3.2) — no "", no placeholder.
            ...(this.userId ? { 'user.id': this.userId } : {}),
            // Denormalized onto every row (§4.5) so "errors by screen" needs no join. The id
            // is the join key; the name is the view's current best, resolved here at log time
            // by lookup on that id, so a row can never carry a name that disagrees with it.
            'view.id': this.views.id,
            'view.name': this.views.name,
            'session.id': this.sessionId,
            'session.start_time': new Date(this.sessionStart).toISOString(),
            'session.sequence': this.sessionSequence,
            // Extrapolation is arithmetic when the rate is on the row: it survives a
            // consumer retuning mid-quarter, which config-in-a-spreadsheet does not.
            'session.sample_rate': this.sampleRate,
            // Monotonic and always present; the reason stays omitted until there is one,
            // so `sdk.drop_reason IS NOT NULL` is a usable filter for "this install lost data".
            'sdk.events_dropped': this.eventsDropped,
            ...(this.dropReason ? { 'sdk.drop_reason': this.dropReason } : {}),
            'sdk.hook_dropped': this.hookDropped,
            'sdk.hook_failed': this.hookFailed,
            'sdk.platform': SDK_PLATFORM,
            'sdk.version': this.sdkVersion,
        };

        if (this.userProfile) {
            const userProfileData = {
                'user.name': this.userProfile.fullName,   // v3 contract key for host identity
                'user.fullName': this.userProfile.fullName,
                'user.firstName': this.userProfile.firstName,
                'user.lastName': this.userProfile.lastName,
                'user.email': this.userProfile.email,
                'user.phone': this.userProfile.phone,
                'user.avatar': this.userProfile.avatar,
                'user.createdAt': this.userProfile.createdAt,
                'user.updatedAt': this.userProfile.updatedAt,
                ...this.flattenWithPrefix('user.custom', this.userProfile.customAttributes || {})
            };
            Object.entries(userProfileData).forEach(([key, value]) => {
                if (value !== undefined) attributes[key] = value;
            });
        }

        return attributes;
    }

    /**
     * Emit a metric on the v3 `type:"metric"` path: { type, metricName, value, timestamp, attributes }.
     * Carries the same Context block as events. Metrics are samples, not user actions, so they
     * don't extend the breadcrumb trail and don't count as session activity — a periodic sampler
     * (memory/frames) must not keep a session alive and defeat the 30-min idle rotation.
     */
    async logMetric(metricName: string, value: number, data?: Record<string, any>) {
        this.eventCount++;
        // A metric is a sample, not a user action: it must not refresh `lastActivity` and
        // keep a dead session alive. It is still *checked* against the boundaries, or a
        // metric-only stream (a backgrounded app sampling memory) would ship forever under
        // a session that expired hours ago and never hit the 4-hour cap (§4.2).
        const reason = this.expiryReason(Date.now());
        if (reason) await this.rotateSession(reason);

        if (!this.sampled) return;

        const attributes = await this.collectContext(data);

        this.enqueue({
            type: 'metric',
            metricName,
            value,
            timestamp: new Date().toISOString(),
            attributes,
        });
        if (this.queue.length >= this.batchSize) {
            void this.flush();
        }
    }

    /**
     * The single enqueue point: neither the sample decision nor `beforeSend` can be
     * bypassed by a future emit path, and the hook runs *before* the queue — which is
     * what keeps scrubbed fields off disk when a send fails and the batch is persisted.
     *
     * The sample check is repeated by log()/logMetric() ahead of `collectContext()`, so
     * a sampled-out session does no work per event; this one is the backstop that makes
     * the guarantee structural rather than a convention two call sites happen to follow.
     *
     * The two counters are separate on purpose: "my volume is down 40%" has to
     * distinguish *my rule is too broad* from *my rule is crashing*, and one merged
     * counter answers neither.
     */
    private enqueue(e: TelemetryEvent) {
        if (!this.sampled) return;

        let kept = e;
        if (this.beforeSend) {
            const outcome = applyBeforeSend(e, this.beforeSend);
            if (outcome.kind === "failed") { this.hookFailed++; return; }
            if (outcome.kind === "dropped") { this.hookDropped++; return; }
            kept = outcome.event;
        }

        // After the hook, never before (§2.4): an event the hook drops must not consume an
        // ordinal, or every scrubbed row would read as a gap — and gaps are precisely how
        // the backend tells real loss from a replay. Tier A already protects the key, so a
        // hook cannot forge or delete one once stamped.
        (kept.attributes ??= {})['event.sequence'] = this.eventSequence++;

        this.queue.push(kept);
        this.capQueue();
    }

    /**
     * Hold the in-memory queue at its cap (§9.4), booking what it costs.
     *
     * The count lands on the *next* event's Context block, not this one's — `collectContext()`
     * has already run by the time we get here. That is §3.7's stated behaviour, not a bug.
     */
    private capQueue() {
        while (this.queue.length > QUEUE_MAX_EVENTS) {
            this.queue.splice(evictIndex(this.queue), 1);
            this.recordDrop("queue_full");
        }
    }

    /**
     * Book dropped rows against the monotonic counter and the reason that shipped last.
     * Takes `Sender.onFailure`'s return shape as-is — a sender with no cap returns nothing.
     */
    private recordDrop(reason: DropReason, count: number | void = 1) {
        if (!count || count <= 0) return;
        this.eventsDropped += count;
        this.dropReason = reason;
    }

    private flattenWithPrefix(prefix: string, obj: Record<string, any>): Record<string, any> {
        const result: Record<string, any> = {};

        for (const key in obj) {
            if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;

            const value = obj[key];
            const prefixedKey = prefix ? `${prefix}.${key}` : key;

            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                Object.assign(result, this.flattenWithPrefix(prefixedKey, value));
            } else {
                result[prefixedKey] = value;
            }
        }

        return result;
    }



    /**
     * Explicit metric helper (optional convenience) — routes through the v3 metric path.
     */
    recordMetric(name: string, value: number, data?: Record<string, any>) {
        return this.logMetric(name, value, data);
    }

    // ---------- Flush / Persistence ----------

    // Retry + backoff live in the Sender (see sendWithRetry in web/native senders),
    // which is also used by the standalone replay paths. flush() does a single send
    // and, on failure, hands the batch to the sender to persist (or requeues it).
    async flush() {
        if (!this.sender || this.queue.length === 0) return;

        // build a batch of up to batchSize
        const toSend = this.queue.splice(0, this.batchSize);

        try {
            await this.sender.send(toSend);
            await this.ackBatch();
        } catch (lastError) {
            if (this.sender.onFailure) {
                try {
                    this.recordDrop("store_full", await this.sender.onFailure(toSend));
                } catch (persistErr) {
                    // If persistence fails, requeue to avoid data loss
                    this.queue.unshift(...toSend);
                    debug.warn("Sender.onFailure failed, requeued events:", persistErr);
                }
            } else {
                this.queue.unshift(...toSend);
            }

            debug.error("Telemetry flush failed:", lastError);
            throw lastError;
        }
    }

    /**
     * Book an acknowledged (2xx) batch. `session.sequence` orders a session's batches (#29),
     * and it is persisted because a resumed session restarting at 0 would emit duplicate
     * (session.id, session.sequence) pairs and stop ordering anything (#92).
     */
    private async ackBatch() {
        this.sessionSequence++;
        await this.persistSession();
    }

    getQueue() {
        return [...this.queue];
    }

    async shutdown() {
        if (this.intervalId) clearInterval(this.intervalId);
        await this.flush();
    }

    // Screen tracking lives in ScreenTimingTracker (this.screens), the single timed API.

    // Expose some internal counters (optional)
    getEventCount() {
        return this.eventCount;
    }

    /**
     * A route change: the view boundary (§4.5) plus, on native only, the two deprecated
     * feeds (§4.11). v3's two native screen paths were disjoint — `attachNavigation` never
     * touched `inst.screens`, so a React Navigation consumer emitted `navigation` on every
     * route change and never a single `screen.duration`. Unifying them here is what fixes
     * that, which is why a *deprecated* event starts firing where it never has.
     */
    async recordRouteChange(from: string, to: string) {
        this.currentScreen = to;   // best-effort screen for subsequent taps (#33)
        if (this.deprecatedScreenFeeds) {
            // Both rows describe the transition, so both are emitted — and awaited — before
            // the view boundary: they belong to the view being left.
            await this.navigationTracker?.recordRouteChange(from, to);
            await this.screens.endScreen(from);
            // Arm the dwell clock for the arriving screen. `markStart`, not `startScreen`:
            // the latter emits its own `navigation`, and the line above already emitted this
            // transition's. This is the join that was missing — v3's `attachNavigation` never
            // touched `screens`, so `screen.duration` never fired for a React Navigation app.
            this.screens.markStart(to);
        }
        await this.enterView(to, "route");
    }

    /**
     * Feed the name ladder (§4.5.1). Rungs 1 and 2 arrive unnormalized; rung 3's caller
     * normalizes before calling. Whether this re-stamps the current view or mints a
     * successor is the ladder's decision, not the caller's.
     */
    async enterView(name: string, source: ViewNameSource) {
        await this.views.navigate(name, source);
    }


}

