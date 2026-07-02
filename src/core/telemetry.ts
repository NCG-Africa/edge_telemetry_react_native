import { NavigationTracker } from "../adapters/navigationTracker";
import { ScreenTimingTracker } from "../adapters/screenTiming";
import { BreadcrumbBuffer } from "./breadcrumbs";
import { randomHex } from "./utils/uuid";
import { version as PKG_VERSION } from "../../package.json";

// v3 wire contract constants
const SDK_PLATFORM = "react-native";   // framework identity; device OS lives in device.platform
const SDK_VERSION = PKG_VERSION;       // sdk.version follows the published package version
const SESSION_IDLE_MS = 30 * 60 * 1000; // rotate the session after 30 min of inactivity (iOS ADR-004)

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

export type TelemetryEvent = {
    type: 'event' | 'metric';
    eventName: string;
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
    isConnected?: boolean;
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
        buildNumber?: string;
        packageName?: string;
    };
    device: {
        id: string;
        platform: string;
        platformVersion?: string;
        model?: string;
        manufacturer?: string;
        brand?: string;
        androidSdk?: string;
        androidRelease?: string;
        fingerprint?: string;
        hardware?: string;
        product?: string;
        iosSystemName?: string;
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
    userId?: string | null;
    sdkVersion?: string;
    platform?: string;          // device OS (ios|android|web); forms the device/session id suffix
    deviceInfoHandler?: DeviceInfoHandler;
    networkInfoHandler?: NetworkInfoHandler;
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

    private frameDropsHandler?: FrameDropsHandler;
    private networkHandler?: NetworkHandler;
    private memoryHandler?: MemoryHandler;
    private navigationHandler?: NavigationHandler;


    // session / user state
    private userId?: string | null = undefined;
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

        // start a session
        this.sessionId = opts?.sessionId ?? this.generateSessionId();
        this.userId = opts?.userId ?? this.generateUserId();
        this.sessionStart = Date.now();
        this.sdkVersion = opts?.sdkVersion ?? SDK_VERSION;

        // auto replay if supported
        if (this.sender?.replayFailed) {
            // don't block constructor; best-effort
            this.sender.replayFailed().catch((err: any) => {
                console.warn("Telemetry replay failed Telemetry class:", err);
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
                device: { id: '', platform: '' }
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
            console.warn("Telemetry crashHandler attach failed:", err);
        });
    }

    getDeviceInfo(deviceInfoHandler: DeviceInfoHandler) {
        this.deviceInfoHandler = deviceInfoHandler;
        void deviceInfoHandler.start(this).catch((err) => {
            console.warn("Telemetry deviceInfo tracking start failed:", err);
        });
    }

    getNetworkInfo(networkInfoHandler: NetworkInfoHandler) {
        this.networkInfoHandler = networkInfoHandler;
        void networkInfoHandler.start(this).catch((err) => {
            console.warn("Telemetry networkInfoHandler start failed:", err);
        });
    }

    public trackFrameDrops(frameDropsHandler: FrameDropsHandler) {
        this.frameDropsHandler = frameDropsHandler;
        void frameDropsHandler.start().catch((err) => {
            console.warn("Telemetry frameDropsHandler start failed:", err);
        });
    }

    public trackNetworkRequests(networkHandler: NetworkHandler) {
        this.networkHandler = networkHandler;
        void networkHandler.start().catch((err) => {
            console.warn("Telemetry networkHandler start failed:", err);
        });
    }

    public trackMemoryUsage(memoryHandler: MemoryHandler) {
        this.memoryHandler = memoryHandler;
        void memoryHandler.recordMemoryUsage().catch((err) => {
            console.warn("Telemetry memoryHandler recordMemoryUsage failed:", err);
        });
    }

    public autoTrackNavigation(navigationHandler?: NavigationHandler) {
        this.navigationHandler = navigationHandler;
        void navigationHandler?.start().catch((err) => {
            console.warn("Telemetry navigationHandler start failed:", err);
        });
    }


    private generateSessionId(): string {
        const base = `session_${Date.now()}_${randomHex(16)}`;
        return this.platform ? `${base}_${this.platform}` : base;
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

    /** Emit session.started for the current session (init / resume). */
    public async startSession() {
        this.lastActivity = Date.now();
        await this.log("session.started", {});
    }

    /** Finalize the current session: journey summary + sdk.error_count, then an immediate flush. */
    public async finalizeSession() {
        await this.log("session.finalized", {
            "session.duration_ms": Date.now() - this.sessionStart,
            "session.event_count": this.sessionEventCount,
            "sdk.error_count": this.errorCount,
        });
        await this.flush();
    }

    /** Begin a fresh session: new id/start, reset per-session counters, emit session.started. */
    public async newSession() {
        this.sessionId = this.generateSessionId();
        this.sessionStart = Date.now();
        this.sessionSequence = 0;
        this.sessionEventCount = 0;
        this.errorCount = 0;
        await this.startSession();
    }

    /** Idle/boundary rotation: finalize the old session then start a fresh one (the pair). */
    public async rotateSession() {
        await this.finalizeSession();
        await this.newSession();
    }

    public setUserId(id: string) {
        this.userId = id;
    }

    public getUserId(): string | undefined | null {
        return this.userId;
    }

    public generateUserId(): string {
        return `user_${Date.now()}_${randomHex(16)}`;
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

        // Update userId if provided in profile
        if (profile.userId) {
            this.userId = profile.userId;
        } else if (this.userProfile && !this.userProfile.userId) {
            // Set current userId in profile if not provided
            this.userProfile.userId = this.userId || undefined;
        }

        console.log("Telemetry: User profile updated", this.userProfile);
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

        console.log("Telemetry: User profile updated", this.userProfile);
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
        console.log("Telemetry: User profile cleared");
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

        // Session activity & 30-min idle rotation. Session events don't count as activity
        // (they're emitted *by* the lifecycle), so they never re-trigger rotation.
        if (!name.startsWith('session.')) {
            const now = Date.now();
            if (this.lastActivity !== undefined && now - this.lastActivity > SESSION_IDLE_MS) {
                await this.rotateSession();
            }
            this.lastActivity = now;
            this.sessionEventCount++;
            if (name === 'app.crash') this.errorCount++;
        }

        // v3 allowlist: unknown names ship as custom_event, original kept as event.name
        const isAllowed = ALLOWED_NAMES.has(name);
        const eventName = isAllowed ? name : 'custom_event';

        let deviceInfo: Record<string, any> = {};
        let networkInfo: Record<string, any> = {};

        try {
            deviceInfo = (await this.deviceInfoHandler?.collect()) || {};
        } catch (err) {
            console.warn("Telemetry: failed to fetch device info", err);
        }

        try {
            networkInfo = (await this.networkInfoHandler?.collect()) || {};
        } catch (err) {
            console.warn("Telemetry: failed to fetch network info", err);
        }

        // 🔄 Flatten all properties into a single `attributes` object
        const attributes: Record<string, any> = {
            // deviceInfo already namespaces its own keys (app.*, device.*) — flatten flat
            ...this.flattenWithPrefix('', deviceInfo),
            ...this.flattenWithPrefix('network', networkInfo),
            ...this.flattenWithPrefix('', data || {}),
            'user.id': this.userId ?? null,
            'session.id': this.sessionId,
            'session.start_time': new Date(this.sessionStart).toISOString(),
            'session.sequence': this.sessionSequence,
            'sdk.platform': SDK_PLATFORM,
            'sdk.version': this.sdkVersion,
            ...(isAllowed ? {} : { 'event.name': name }),
        };

        // Add user profile data if available
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

            // Only add non-undefined values
            Object.entries(userProfileData).forEach(([key, value]) => {
                if (value !== undefined) {
                    attributes[key] = value;
                }
            });
        }

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

        console.log("Telemetry queued event:", name, "Queue size:", this.queue.length);
        console.log("Event attributes:", attributes);

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
     * Explicit metric helper (optional convenience).
     */
    recordMetric(name: string, value: number, data?: Record<string, any>) {
        this.log(name, { ...data, value, metric: true });
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
        } catch (lastError) {
            if (this.sender.onFailure) {
                try {
                    await this.sender.onFailure(toSend);
                } catch (persistErr) {
                    // If persistence fails, requeue to avoid data loss
                    this.queue.unshift(...toSend);
                    console.warn("Sender.onFailure failed, requeued events:", persistErr);
                }
            } else {
                this.queue.unshift(...toSend);
            }

            console.error("Telemetry flush failed:", lastError);
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

