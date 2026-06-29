// adapters/native/networkInfoNative.native.ts
import NetInfo from "@react-native-community/netinfo";
import { NetworkInfo, NetworkInfoChanges, Telemetry } from "../../core/telemetry";


export class NetworkInfoTrackerNative {
    private telemetry?: Telemetry;

    // constructor(telemetry: Telemetry) {
    //     this.telemetry = telemetry;
    // }

    constructor() {

    }

    async collect(): Promise<NetworkInfo> {
        console.log("network_info collecting");
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
     * Context-only — collect() feeds the Context block on every event;
     * no standalone network_info event (ADR-0002).
     */
    async start(telemetry: Telemetry): Promise<NetworkInfo> {
        this.telemetry = telemetry;
        return this.collect();
    }

    /**
     * Subscribe to changes and log them continuously.
     */
    subscribe(telemetry: Telemetry): void {
        this.telemetry = telemetry;
        NetInfo.addEventListener(state => {
            const event: NetworkInfoChanges = {
                type: state.type,
                isConnected: state.isConnected ?? undefined,
                isInternetReachable: state.isInternetReachable ?? undefined,
            };
            if (this.telemetry) {
                this.telemetry.log("network_info_change", event);
            }
        });
    }
}
