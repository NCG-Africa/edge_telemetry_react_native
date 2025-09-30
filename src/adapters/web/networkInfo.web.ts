// adapters/web/networkInfoWeb.web.ts
import { NetworkInfo, Telemetry } from "../../core/telemetry";




export async function getNetworkInfo(): Promise<NetworkInfo> {
    if (typeof navigator !== "undefined" && "connection" in navigator) {
        const conn = (navigator as any).connection;
        return {
            type: conn.type || "unknown",
            isConnected: navigator.onLine,
            // downlink: conn.downlink,
            // effectiveType: conn.effectiveType,
        };
    }

    // Fallback
    return {
        type: "unknown",
        isConnected: typeof navigator !== "undefined" ? navigator.onLine : undefined,
    };
}

export class NetworkInfoTrackerWeb {
    // constructor(private telemetry: Telemetry) { }
    constructor() { }

    async collect(): Promise<NetworkInfo> {
        return getNetworkInfo();
    }

    private telemetry!: Telemetry;

    async start(telemetry: Telemetry): Promise<NetworkInfo> {
        this.telemetry = telemetry;
        const info = await this.collect();
        this.telemetry.log("network_info", info);
        return info;
    }
}
