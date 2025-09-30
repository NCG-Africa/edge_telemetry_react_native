export declare class TelemetryWeb {
    private instancePromise;
    constructor(opts?: {
        sender?: any;
        batchSize?: number;
        flushIntervalMs?: number;
        endpoint?: string;
    });
    trackErrors(): Promise<any>;
    trackFrameDrops(): Promise<any>;
    trackNetworkRequests(): Promise<any>;
    trackMemoryUsage(): Promise<any>;
    autoTrackNavigation(): Promise<any>;
    getDeviceInfo(): Promise<any>;
    getNetworkInfo(): Promise<any>;
    log(event: string, data?: Record<string, any>): Promise<any>;
    flush(): Promise<any>;
    setUserProfile(profile: {
        userId?: string;
        fullName?: string;
        firstName?: string;
        lastName?: string;
        email?: string;
        phone?: string;
        avatar?: string;
        customAttributes?: Record<string, any>;
    }): Promise<void>;
    setUserDetails(details: {
        fullName?: string;
        firstName?: string;
        lastName?: string;
        email?: string;
        phone?: string;
        avatar?: string;
        customAttributes?: Record<string, any>;
    }): Promise<void>;
    updateUserProfile(updates: {
        userId?: string;
        fullName?: string;
        firstName?: string;
        lastName?: string;
        email?: string;
        phone?: string;
        avatar?: string;
        customAttributes?: Record<string, any>;
    }): Promise<void>;
    getUserProfile(): Promise<any>;
    clearUserProfile(): Promise<void>;
    setUserName(fullName: string, firstName?: string, lastName?: string): Promise<void>;
    setUserContact(email?: string, phone?: string): Promise<void>;
    setUserId(id: string): Promise<void>;
    generateUserId(): Promise<any>;
    shutdown(): Promise<any>;
}
