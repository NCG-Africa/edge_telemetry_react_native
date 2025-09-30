import { NavigationTracker } from "../adapters/navigationTracker";

export type TelemetryEvent = {
    name: string;
    data?: Record<string, any>;
    timestamp: number;
    // injected metadata
    userId?: string | null;
    sessionId?: string;
};

export interface Sender {
    send(events: TelemetryEvent[]): Promise<void>;
    onFailure?(events: TelemetryEvent[]): Promise<void>;
    replayFailed?(): Promise<void>;
}

export interface RandomStringGenerator {
    generate(): String;
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
    private navigationTracker?: NavigationTracker;

    // session / user state
    private userId?: string | null = undefined;
    private sessionId: string;
    private sessionStart: number;
    private visitedScreens: Set<string> = new Set();
    private eventCount = 0;
    private metricCount = 0;

    constructor(opts?: Opts) {
        this.sender = opts?.sender;
        this.batchSize = opts?.batchSize ?? 10;
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
                console.warn("Telemetry replay failed:", err);
            });
        }

        if (this.flushIntervalMs > 0) {
            this.intervalId = setInterval(() => this.flush().catch(() => { }), this.flushIntervalMs);
        }

        this.navigationTracker = new NavigationTracker(this);

    }

    // ---------- Session & User APIs ----------

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

    // Optional: set user profile fields if you want to extend later
    // public setUserProfile(...) { ... }

    // ---------- Logging APIs ----------

    /**
     * Log a named event. Keeps existing signature compatibility.
     * Automatically attaches userId and sessionId to every queued event.
     */
    log(name: string, data?: Record<string, any>) {
        this.eventCount++;
        const e: TelemetryEvent = {
            name,
            data,
            timestamp: Date.now(),
            userId: this.userId ?? null,
            sessionId: this.sessionId,
        };
        this.queue.push(e);
        if (this.queue.length >= this.batchSize) {
            void this.flush();
        }
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
                await this.sender.send(toSend);
                return;
            } catch (err) {
                lastError = err;
                attempts++;

                if (attempts >= this.retryCount) {
                    // final failure: let sender persist if available, otherwise requeue at the front
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
                    throw lastError;
                }

                // wait with exponential backoff + jitter
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

