// src/index.web.ts
import { TelemetryMemoryUsageWeb } from "./adapters/web/memoryWeb.web";

export class TelemetryWeb {
    private instancePromise: Promise<any>;

    private memoryTracker?: TelemetryMemoryUsageWeb;

    constructor(opts?: {
        sender?: any;
        batchSize?: number;
        flushIntervalMs?: number;
        endpoint?: string;
    }) {

        console.log("🌍 Running Web Telemetry");

        this.instancePromise = (async () => {
            const { Telemetry } = await import("./core/telemetry");
            const { webSender } = await import("./adapters/webSender");
            const { interceptHttp } = await import("./adapters/web/interceptFetchWeb.web");
            const { generateId } = await import("./core/utils/uuid.web");

            const sender = opts?.sender ?? webSender(opts?.endpoint);

            const telemetry = new Telemetry({
                sender,
                batchSize: opts?.batchSize,
                flushIntervalMs: opts?.flushIntervalMs,
                endpoint: opts?.endpoint,
                RandomnStringGenerator: { generate: generateId }
            });

            // 🔥 Auto-init HTTP + XHR interception
            interceptHttp(telemetry);
            // auto init memory tracker
            this.memoryTracker = new TelemetryMemoryUsageWeb(telemetry);
            this.memoryTracker.start(); // runs every 30s by default


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




