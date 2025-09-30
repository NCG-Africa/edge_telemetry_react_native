export declare class TelemetryNative {
    private instancePromise;
    constructor(opts?: {
        sender?: any;
        batchSize?: number;
        flushIntervalMs?: number;
        endpoint?: string;
    });
    getDeviceInfo(): Promise<any>;
    getNetworkInfo(): Promise<any>;
    trackErrors(): Promise<any>;
    trackFrameDrops(): Promise<any>;
    trackNetworkRequests(): Promise<any>;
    trackMemoryUsage(): Promise<any>;
    log(event: string, data?: Record<string, any>): Promise<any>;
    flush(): Promise<any>;
    setUserId(id: string): Promise<void>;
    generateUserId(): Promise<any>;
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
    screenStart(name: string): Promise<void>;
    screenEnd(name: string): Promise<void>;
    trackRoute(from: string, to: string): Promise<void>;
    shutdown(): Promise<any>;
    attachNavigation(navigationRef: any): Promise<void>;
}
