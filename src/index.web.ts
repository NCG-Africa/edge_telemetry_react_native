// src/index.web.ts
export class TelemetryWeb {
    private instancePromise: Promise<any>;

    constructor(opts?: {
        sender?: any;
        batchSize?: number;
        flushIntervalMs?: number;
        endpoint?: string;
    }) {
        this.instancePromise = (async () => {
            const { Telemetry } = await import("./core/telemetry");
            const { webSender } = await import("./adapters/webSender");
            const { interceptHttp } = await import("./adapters/web/interceptFetchWeb");

            const sender = opts?.sender ?? webSender(opts?.endpoint);

            const telemetry = new Telemetry({
                sender,
                batchSize: opts?.batchSize,
                flushIntervalMs: opts?.flushIntervalMs,
                endpoint: opts?.endpoint,
            });

            // 🔥 Auto-init HTTP + XHR interception
            interceptHttp(telemetry);

            return telemetry;
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




// export class TelemetryWeb {
//     private instancePromise: Promise<any>;

//     constructor(opts?: {
//         sender?: any;
//         batchSize?: number;
//         flushIntervalMs?: number;
//         endpoint?: string;             // 👈 allow endpoint
//     }) {
//         this.instancePromise = (async () => {
//             const { Telemetry } = await import("./core/telemetry");
//             const sender = opts?.sender ?? (await import("./adapters/webSender")).webSender;
//             return new Telemetry({
//                 sender,
//                 batchSize: opts?.batchSize,
//                 flushIntervalMs: opts?.flushIntervalMs,
//                 endpoint: opts?.endpoint,  // 👈 forward endpoint
//             });
//         })();
//     }

//     async log(event: string, data?: Record<string, any>) {
//         const inst = await this.instancePromise;
//         return inst.log(event, data);
//     }

//     async flush() {
//         const inst = await this.instancePromise;
//         return inst.flush();
//     }

//     async shutdown() {
//         const inst = await this.instancePromise;
//         return inst.shutdown();
//     }
// }




