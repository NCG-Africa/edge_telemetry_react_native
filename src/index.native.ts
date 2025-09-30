export class TelemetryNative {
    private instancePromise: Promise<any>;

    constructor(opts?: {
        sender?: any;
        batchSize?: number;
        flushIntervalMs?: number;
        endpoint?: string;              // 👈 allow endpoint
    }) {
        this.instancePromise = (async () => {
            const { Telemetry } = await import("./core/telemetry");
            const sender = opts?.sender ?? (await import("./adapters/nativeSender")).nativeSender;
            return new Telemetry({
                sender,
                batchSize: opts?.batchSize,
                flushIntervalMs: opts?.flushIntervalMs,
                endpoint: opts?.endpoint,   // 👈 forward endpoint to core
            });
        })();
    }

    async log(event: string, data?: Record<string, any>) {
        const inst = await this.instancePromise;
        return inst.log(event, data);
    }

    async flush() {
        const inst = await this.instancePromise;
        return inst.flush();
    }

    async shutdown() {
        const inst = await this.instancePromise;
        return inst.shutdown();
    }
}



// export { Telemetry } from "./core/telemetry";
// export { nativeSender } from "./adapters/nativeSender";

// export async function createTelemetryNative(opts?: { sender?: any; batchSize?: number; flushIntervalMs?: number }) {
//     const { Telemetry } = await import("./core/telemetry");
//     const sender = opts?.sender ?? (await import("./adapters/nativeSender")).nativeSender;
//     return new Telemetry({ sender, batchSize: opts?.batchSize, flushIntervalMs: opts?.flushIntervalMs });
// }
