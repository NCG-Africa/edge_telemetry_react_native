// adapters/web/networkInfoWeb.web.ts
import { NetworkInfo, Telemetry } from "../../core/telemetry";
import { NetworkChangeEmitter } from "../networkChange";




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
        // collect() feeds the steady-state Context block (no standalone network_info event,
        // ADR-0002). A connectivity *transition* is its own v3 `network_change` event,
        // emitted via the shared NetworkChangeEmitter (lockstep with native).
        this.telemetry = telemetry;
        const changes = new NetworkChangeEmitter(telemetry);
        const info = await this.collect();
        changes.onSample(info.type);   // seed baseline so the first real transition emits
        const sample = async () => changes.onSample((await getNetworkInfo()).type);

        const conn = typeof navigator !== "undefined" ? (navigator as any).connection : undefined;
        conn?.addEventListener?.("change", sample);
        if (typeof window !== "undefined") {
            window.addEventListener("online", sample);
            window.addEventListener("offline", sample);
        }
        return info;
    }
}
