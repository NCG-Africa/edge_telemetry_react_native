export type TelemetryEvent = {
    name: string;
    data?: Record<string, any>;
    timestamp: number;
};

export interface Sender {
    send(events: TelemetryEvent[]): Promise<void>;
    onFailure?(events: TelemetryEvent[]): Promise<void>; // optional persistence
}

type Opts = {
    sender?: Sender;
    batchSize?: number;
    flushIntervalMs?: number;
    endpoint?: string;
    retryCount?: number; // 👈 configurable retries
};

export class Telemetry {
    private queue: TelemetryEvent[] = [];
    private sender?: Sender;
    private batchSize: number;
    private flushIntervalMs: number;
    private intervalId: any = null;
    private retryCount: number;

    constructor(opts?: Opts) {
        this.sender = opts?.sender;
        this.batchSize = opts?.batchSize ?? 10;
        this.flushIntervalMs = opts?.flushIntervalMs ?? 10000;
        this.retryCount = opts?.retryCount ?? 3;

        // 👇 auto replay if supported
        if (this.sender && "replayFailed" in this.sender) {
            (this.sender as any).replayFailed().catch((err: any) =>
                console.warn("Telemetry replay failed:", err)
            );
        }

        if (this.flushIntervalMs > 0) {
            this.intervalId = setInterval(() => this.flush().catch(() => { }), this.flushIntervalMs);
        }
    }

    log(name: string, data?: Record<string, any>) {
        const e: TelemetryEvent = { name, data, timestamp: Date.now() };
        this.queue.push(e);
        if (this.queue.length >= this.batchSize) {
            void this.flush();
        }
    }

    async flush() {
        if (!this.sender || this.queue.length === 0) return;
        const toSend = this.queue.splice(0, this.batchSize);
        let attempts = 0;

        while (attempts < this.retryCount) {
            try {
                await this.sender.send(toSend);
                return;
            } catch (err) {
                attempts++;
                if (attempts >= this.retryCount) {
                    if (this.sender.onFailure) {
                        await this.sender.onFailure(toSend);
                    } else {
                        this.queue.unshift(...toSend);
                    }
                    throw err;
                }
                await new Promise(res => setTimeout(res, attempts * 500));
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
}


// export class Telemetry {
//     private queue: TelemetryEvent[] = [];
//     private sender?: Sender;
//     private batchSize: number;
//     private flushIntervalMs: number;
//     private intervalId: any = null;
//     private endpoint: string;

//     constructor(opts?: Opts) {
//         this.sender = opts?.sender;
//         this.batchSize = opts?.batchSize ?? 10;
//         this.flushIntervalMs = opts?.flushIntervalMs ?? 10000;
//         this.endpoint = opts?.endpoint ?? "https://your.telemetry.endpoint/collect";

//         if (this.flushIntervalMs > 0) {
//             this.intervalId = setInterval(
//                 () => this.flush().catch(() => { /* swallow errors in interval */ }),
//                 this.flushIntervalMs
//             );
//         }
//     }

//     log(name: string, data?: Record<string, any>) {
//         const e: TelemetryEvent = { name, data, timestamp: Date.now() };
//         this.queue.push(e);

//         if (this.queue.length >= this.batchSize) {
//             void this.flush();
//         }
//     }

//     async flush() {
//         if (!this.sender || this.queue.length === 0) return;

//         const toSend = this.queue.splice(0, this.batchSize);
//         let attempts = 0;
//         const maxRetries = this.retryCount ?? 3;

//         while (attempts < maxRetries) {
//             try {
//                 await this.sender.send(toSend);
//                 return;
//             } catch (err) {
//                 attempts++;
//                 if (attempts >= maxRetries) {
//                     if (this.sender.onFailure) {
//                         await this.sender.onFailure(toSend);
//                     } else {
//                         // requeue at front
//                         this.queue.unshift(...toSend);
//                     }
//                     throw err;
//                 }
//                 // wait a bit before retry (exponential backoff)
//                 await new Promise(res => setTimeout(res, attempts * 500));
//             }
//         }
//     }


//     getQueue() {
//         return [...this.queue];
//     }

//     async shutdown() {
//         if (this.intervalId) clearInterval(this.intervalId);
//         await this.flush();
//     }
// }
