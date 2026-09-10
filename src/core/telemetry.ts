import { debug } from "./debug";
import { NavigationTracker } from "../adapters/navigationTracker";
import { ScreenTimingTracker } from "../adapters/screenTiming";
import { BreadcrumbBuffer } from "./breadcrumbs";
import { randomHex } from "./utils/uuid";
import type { Store } from "./store";
import { memoryStore } from "./memoryStore";
import { version as PKG_VERSION } from "../../package.json";

// v3 wire contract constants
const SDK_PLATFORM = "react-native";   // framework identity; device OS lives in device.platform
const SDK_VERSION = PKG_VERSION;       // sdk.version follows the published package version
const SESSION_IDLE_MS = 30 * 60 * 1000; // rotate the session after 30 min of inactivity (iOS ADR-004)
// New in v4 (§4.2). Removing the process-death boundary lets a backgrounded app's
// http.request traffic hold one session open forever; this bounds length, not count.
const SESSION_MAX_MS = 4 * 60 * 60 * 1000;

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
    eventCount: number;
    errorCount: number;
};

/** What hydration decided, so the emitting half stays free of storage concerns. */
type SessionHydration =
    | { kind: "resumed" }                                   // inside the idle window: no session.started (§4.1)
    | { kind: "new" }                                       // nothing durable to resume
    | { kind: "expired"; reason: SessionEndReason };        // adopted, now owed a finalize + a fresh session
/** The collector caps `user.id` at 255; truncate at source rather than be rejected (§3.2). */
const USER_ID_MAX = 255;

// Names the backend routes. Anything else is remapped to `custom_event` with the
// original name carried as `event.name`. Includes metric names so the metric path
// (slice: native metrics) isn't remapped.
const ALLOWED_NAMES = new Set<string>([
    "session.started", "session.finalized", "app_lifecycle", "page_load", "navigation",
    "screen.duration", "http.request", "user.interaction", "network_change",
    "user.profile.update", "custom_event", "app.crash",
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
    onFailure?(events: TelemetryEvent[]): Promise<void>;
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
};

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
    private sessionEventCount = 0;       // events this session (journey summary)
    private errorCount = 0;              // app.crash count this session (sdk.error_count)

    constructor(opts?: Opts) {
        this.sender = opts?.sender;
        this.batchSize = opts?.batchSize ?? 2;
        this.flushIntervalMs = opts?.flushIntervalMs ?? 10000;
        this.endpoint = opts?.endpoint;
        this.platform = opts?.platform;   // set before id generation (suffix source)
        this.store = opts?.store ?? memoryStore({ unavailable: true });

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

    public startNewSession() {
        this.sessionId = this.generateSessionId();
        this.sessionStart = Date.now();
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
        if (decision.kind === "new") { await this.startSession("launch"); return; }
        // Expired: hydration adopted the old id/start so the finalize ships under them.
        await this.rotateSession(decision.reason);
    }

    /**
     * Read the durable record and adopt it. Adoption happens even when the session has
     * expired: `session.finalized` has to ship under the *old* `session.id` and
     * `session.start_time` before the fresh one takes over.
     */
    private async hydrateSession(): Promise<SessionHydration> {
        const read = await this.store.get(SESSION_KEY);
        if (read.status !== "hit") return { kind: "new" };

        let saved: Partial<PersistedSession>;
        try { saved = JSON.parse(read.value); } catch { return { kind: "new" }; }
        // A record we can't trust is not a session to resume; mint rather than guess.
        if (typeof saved?.id !== "string"
            || typeof saved.start !== "number"
            || typeof saved.lastActivity !== "number") return { kind: "new" };

        this.sessionId = saved.id;
        this.sessionStart = saved.start;
        this.lastActivity = saved.lastActivity;
        this.sessionSequence = saved.sequence ?? 0;
        this.sessionEventCount = saved.eventCount ?? 0;
        this.errorCount = saved.errorCount ?? 0;

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
        if (now - this.lastActivity > SESSION_IDLE_MS) return "idle";
        if (now - this.sessionStart >= SESSION_MAX_MS) return "max_duration";
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
            eventCount: this.sessionEventCount,
            errorCount: this.errorCount,
        };
        await this.store.set(SESSION_KEY, JSON.stringify(record));
    }

    /** Emit session.started for the current session. */
    public async startSession(reason: SessionReason = "launch") {
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
    public async newSession(reason: SessionReason = "launch") {
        this.sessionId = this.generateSessionId();
        this.sessionStart = Date.now();
        this.sessionSequence = 0;
        this.sessionEventCount = 0;
        this.errorCount = 0;
        await this.startSession(reason);
    }

    /** Boundary rotation: finalize the old session then start a fresh one (the pair). */
    public async rotateSession(reason: SessionEndReason) {
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

        // Session activity and the two boundaries — 30-min idle and the 4-hour cap (§4.2).
        // Session events don't count as activity (they're emitted *by* the lifecycle), so
        // they never re-trigger a rotation.
        if (!name.startsWith('session.')) {
            const now = Date.now();
            const reason = this.expiryReason(now);
            if (reason) await this.rotateSession(reason);
            this.lastActivity = now;
            this.sessionEventCount++;
            if (name === 'app.crash') this.errorCount++;
            await this.persistSession();   // the record the next process resumes from
        }

        // v3 allowlist: unknown names ship as custom_event, original kept as event.name
        const isAllowed = ALLOWED_NAMES.has(name);
        const eventName = isAllowed ? name : 'custom_event';

        const attributes = await this.collectContext(data);
        if (!isAllowed) attributes['event.name'] = name;

        // app.crash carries the trail of prior actions; other events extend the trail.
        if (eventName === 'app.crash') {
            attributes['crash.breadcrumbs'] = this.breadcrumbs.toJSON();
        } else {
            this.breadcrumbs.add({ name: eventName, timestamp: new Date().toISOString() });
        }

        const e: TelemetryEvent = {
            type: 'event',
            eventName,
            timestamp: new Date().toISOString(),
            attributes,
        };

        this.queue.push(e);

        debug.log("Telemetry queued event:", name, "Queue size:", this.queue.length);
        debug.log("Event attributes:", attributes);

        if (this.queue.length >= this.batchSize) {
            void this.flush();
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
            'session.id': this.sessionId,
            'session.start_time': new Date(this.sessionStart).toISOString(),
            'session.sequence': this.sessionSequence,
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
        const attributes = await this.collectContext(data);

        const m: TelemetryEvent = {
            type: 'metric',
            metricName,
            value,
            timestamp: new Date().toISOString(),
            attributes,
        };

        this.queue.push(m);
        if (this.queue.length >= this.batchSize) {
            void this.flush();
        }
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
            this.sessionSequence++;   // acknowledged (2xx) batch — order a session's batches (#29)
            // Persist it too: a resumed session that restarts at 0 would emit duplicate
            // (session.id, session.sequence) pairs and stop ordering anything (#92).
            await this.persistSession();
        } catch (lastError) {
            if (this.sender.onFailure) {
                try {
                    await this.sender.onFailure(toSend);
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

    recordRouteChange(from: string, to: string) {
        this.currentScreen = to;   // best-effort screen for subsequent taps (#33)
        return this.navigationTracker?.recordRouteChange(from, to);
    }


}

