import { NetworkInfo, Telemetry } from '../../core/telemetry';
export declare function getNetworkInfo(): Promise<NetworkInfo>;
export declare class NetworkInfoTrackerWeb {
    constructor();
    collect(): Promise<NetworkInfo>;
    private telemetry;
    start(telemetry: Telemetry): Promise<NetworkInfo>;
}
