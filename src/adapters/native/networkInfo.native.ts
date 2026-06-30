// adapters/native/networkInfoNative.native.ts
import NetInfo from "@react-native-community/netinfo";
import { NetworkInfo, Telemetry } from "../../core/telemetry";
import { NetworkChangeEmitter } from "../networkChange";


export class NetworkInfoTrackerNative {
    private telemetry?: Telemetry;

    constructor() {

    }

    async collect(): Promise<NetworkInfo> {
        try {
            const netState = await NetInfo.fetch();
            return {
                type: netState.type,
                isConnected: netState.isConnected ?? undefined,
            };
        } catch {
            return { type: "unknown", isConnected: undefined };
        }
    }

    /**
     * collect() feeds the steady-state Context block on every event (no standalone
     * network_info event, ADR-0002). A connectivity *transition* is still its own
     * v3 `network_change` event, emitted via the shared NetworkChangeEmitter.
     */
    async start(telemetry: Telemetry): Promise<NetworkInfo> {
        this.telemetry = telemetry;
        const changes = new NetworkChangeEmitter(telemetry);
        const info = await this.collect();
        changes.onSample(info.type);   // seed baseline so the first real transition emits
        NetInfo.addEventListener(state => changes.onSample(state.type));
        return info;
    }
}
