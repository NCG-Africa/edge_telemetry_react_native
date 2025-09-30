export type TelemetryEvent = {
    eventName: string;
    timestamp: number;
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
    type?: string;
    isConnected?: boolean;
}
export interface NetworkInfoChanges {
    type?: string;
    isConnected?: boolean;
    isInternetReachable?: boolean;
}
export interface WebExtraNetworkInfo {
    type?: string;
    isConnected?: boolean;
    downlink?: number;
    effectiveType?: string;
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
export declare class Telemetry {
    private queue;
    private sender?;
    private batchSize;
    private flushIntervalMs;
    private intervalId;
    private retryCount;
    private endpoint?;
    private generateRandomString?;
    private crashHandler?;
    private navigationTracker?;
    private networkInfoHandler;
    private deviceInfoHandler;
    private frameDropsHandler?;
    private networkHandler?;
    private memoryHandler?;
    private navigationHandler?;
    private userId?;
    private userProfile?;
    private sessionId;
    private sessionStart;
    private visitedScreens;
    private eventCount;
    private metricCount;
    constructor(opts?: Opts);
    trackErrors(crashHandler: CrashHandler): Promise<void>;
    getDeviceInfo(deviceInfoHandler: DeviceInfoHandler): Promise<unknown>;
    getNetworkInfo(networkInfoHandler: NetworkInfoHandler): Promise<unknown>;
    trackFrameDrops(frameDropsHandler: FrameDropsHandler): Promise<void>;
    trackNetworkRequests(networkHandler: NetworkHandler): Promise<void>;
    trackMemoryUsage(memoryHandler: MemoryHandler): Promise<void>;
    autoTrackNavigation(navigationHandler?: NavigationHandler): Promise<void>;
    private generateSessionId;
    setSessionId(id: string): void;
    getSessionId(): string;
    startNewSession(): void;
    setUserId(id: string): void;
    getUserId(): string | undefined | null;
    generateUserId(): string;
    /**
     * Set complete user profile information
     */
    setUserProfile(profile: Partial<UserProfile>): void;
    /**
     * Set user details with individual parameters
     */
    setUserDetails(details: {
        fullName?: string;
        firstName?: string;
        lastName?: string;
        email?: string;
        phone?: string;
        avatar?: string;
        customAttributes?: Record<string, any>;
    }): void;
    /**
     * Update specific user profile fields
     */
    updateUserProfile(updates: Partial<UserProfile>): void;
    /**
     * Get current user profile
     */
    getUserProfile(): UserProfile | undefined;
    /**
     * Clear user profile data
     */
    clearUserProfile(): void;
    /**
     * Set user name (convenience method)
     */
    setUserName(fullName: string, firstName?: string, lastName?: string): void;
    /**
     * Set user contact info (convenience method)
     */
    setUserContact(email?: string, phone?: string): void;
    /**
     * Log a named event. Keeps existing signature compatibility.
     * Automatically attaches userId and sessionId to every queued event.
     */
    log(name: string, data?: Record<string, any>): Promise<void>;
    private flattenWithPrefix;
    /**
     * Explicit metric helper (optional convenience) - increments metric counter.
     */
    recordMetric(name: string, value: number, data?: Record<string, any>): void;
    recordNavigation(from: string, to: string): void;
    private exponentialBackoffDelay;
    flush(): Promise<void>;
    getQueue(): TelemetryEvent[];
    shutdown(): Promise<void>;
    startScreen(screenName: string): void;
    endScreen(screenName: string): void;
    getEventCount(): number;
    getMetricCount(): number;
    recordRouteChange(from: string, to: string): void | undefined;
}
export {};
