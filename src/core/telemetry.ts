import { NavigationTracker } from "../adapters/navigationTracker";

export type TelemetryEvent = {
    eventName: string;
    // data?: Record<string, any>;
    timestamp: number;
    // injected metadata
    userId?: string | null;
    sessionId?: string;
    type: 'event' | 'metric';
    attributes?: Record<string, any>;
};

export interface Sender {
    send(events: TelemetryEvent[]): Promise<void>;
    onFailure?(events: TelemetryEvent[]): Promise<void>;
    replayFailed?(): Promise<void>;
}



export interface CrashHandler {
    attach(): Promise<void>;

}
export interface NetworkInfo {
    type?: string;        // "wifi", "cellular", "ethernet", "unknown", etc.
    isConnected?: boolean;
}

export interface NetworkInfoChanges {
    type?: string;        // "wifi", "cellular", "ethernet", "unknown", etc.
    isConnected?: boolean;
    isInternetReachable?: boolean;
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


export interface RandomStringGenerator {
    generate(): String;
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
    retryCount?: number;
    sessionId?: string;
    userId?: string | null;
    RandomnStringGenerator?: RandomStringGenerator;
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
    private retryCount: number;
    private endpoint?: string;
    private generateRandomString?: RandomStringGenerator;
    private crashHandler?: CrashHandler;
    private navigationTracker?: NavigationTracker;

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
    private visitedScreens: Set<string> = new Set();
    private eventCount = 0;
    private metricCount = 0;

    constructor(opts?: Opts) {
        this.sender = opts?.sender;
        this.batchSize = opts?.batchSize ?? 2;
        this.flushIntervalMs = opts?.flushIntervalMs ?? 10000;
        this.retryCount = opts?.retryCount ?? 3;
        this.endpoint = opts?.endpoint;
        this.generateRandomString = opts?.RandomnStringGenerator ?? {
            generate: () => Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
        };

        // start a session
        this.sessionId = opts?.sessionId ?? this.generateSessionId();
        this.userId = opts?.userId ?? this.generateUserId();
        this.sessionStart = Date.now();

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

    public trackErrors(crashHandler: CrashHandler) {
        this.crashHandler = crashHandler;
        void crashHandler.attach().catch((err) => {
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
        const randomnString = this.generateRandomString?.generate() ?? Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        return `session_${Date.now()}_${randomnString.slice(0, 8)}`;
    }

    public setSessionId(id: string) {
        this.sessionId = id;
        this.sessionStart = Date.now();
    }

    public getSessionId(): string {
        return this.sessionId;
    }

    public startNewSession() {
        this.sessionId = this.generateSessionId();
        this.sessionStart = Date.now();
        this.visitedScreens.clear();
    }

    public setUserId(id: string) {
        this.userId = id;
    }

    public getUserId(): string | undefined | null {
        return this.userId;
    }

    public generateUserId(): string {
        const randomnString = this.generateRandomString?.generate() ?? Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        return `user_${Date.now()}_${randomnString.slice(0, 8)}`;
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
            ...this.flattenWithPrefix('device', deviceInfo),
            ...this.flattenWithPrefix('network', networkInfo),
            ...this.flattenWithPrefix('', data || {}),
            'user.id': this.userId ?? null,
            'session.id': this.sessionId,
            'session.event_count': this.eventCount,
            'timestamp': new Date().toISOString(),
        };

        // Add user profile data if available
        if (this.userProfile) {
            const userProfileData = {
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

        const e: TelemetryEvent = {
            eventName: name,
            type: 'event',
            timestamp: Date.now(),
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
     * Explicit metric helper (optional convenience) - increments metric counter.
     */
    recordMetric(name: string, value: number, data?: Record<string, any>) {
        this.metricCount++;
        this.log(name, { ...data, value, metric: true });
    }

    recordNavigation(from: string, to: string) {
        if (this.navigationTracker) {
            this.navigationTracker.recordRouteChange(from, to);
        }
        this.log("navigation", { from, to });
    }
    // ---------- Flush / Retry / Persistence ----------

    private exponentialBackoffDelay(attempts: number) {
        // base=500ms, exponential, plus jitter up to 200ms
        return 500 * 2 ** attempts + Math.floor(Math.random() * 200);
    }

    async flush() {
        if (!this.sender || this.queue.length === 0) return;

        // build a batch of up to batchSize
        const toSend = this.queue.splice(0, this.batchSize);

        let attempts = 0;
        let lastError: any = null;

        while (attempts < this.retryCount) {
            try {
                console.log("Telemetry flush attempt", attempts + 1, "for batch size:", toSend.length);
                await this.sender.send(toSend);
                console.log("Telemetry sent batch of events, size:", toSend.length);
                return;
            } catch (err) {
                lastError = err;
                attempts++;

                if (attempts >= this.retryCount) {
                    // final failure: let sender persist if available, otherwise requeue at the front
                    if (this.sender.onFailure) {
                        try {
                            console.warn("Telemetry send failed after retries, invoking sender.onFailure:", lastError);
                            await this.sender.onFailure(toSend);
                            console.log("Sender.onFailure completed");
                        } catch (persistErr) {
                            // If persistence fails, requeue to avoid data loss
                            this.queue.unshift(...toSend);
                            console.warn("Sender.onFailure failed, requeued events:", persistErr);
                        }
                    } else {

                        console.warn("Telemetry send failed after retries, requeuing events .sender.onFailure:", lastError);
                        this.queue.unshift(...toSend);
                    }

                    console.error("Telemetry flush failed after retries:", lastError);
                    throw lastError;
                }

                // wait with exponential backoff + jitter
                console.warn("Telemetry send attempt failed, will retry Catch Block:", lastError);
                const waitMs = this.exponentialBackoffDelay(attempts);
                await new Promise((res) => setTimeout(res, waitMs));
            }
        }
    }

    getQueue() {
        return [...this.queue];
    }

    async shutdown() {
        if (this.intervalId) clearInterval(this.intervalId);
        await this.flush();
    }

    // ---------- Screen tracking helpers (simple) ----------
    public startScreen(screenName: string) {
        this.visitedScreens.add(screenName);
        this.log("screen_view", { "screen.name": screenName });
    }

    public endScreen(screenName: string) {
        // no timing stored here by default — external ScreenTimingTracker can call log with duration
        this.log("screen_end", { "screen.name": screenName });
    }

    // Expose some internal counters (optional)
    getEventCount() {
        return this.eventCount;
    }

    getMetricCount() {
        return this.metricCount;
    }

    recordRouteChange(from: string, to: string) {
        return this.navigationTracker?.recordRouteChange(from, to);
    }


}

