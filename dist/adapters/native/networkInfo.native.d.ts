import { NetworkInfo, Telemetry } from '../../core/telemetry';
export declare class NetworkInfoTrackerNative {
    private telemetry?;
    constructor();
    collect(): Promise<NetworkInfo>;
    /**
     * Collects and logs the current network state once.
     */
    start(telemetry: Telemetry): Promise<NetworkInfo>;
    /**
     * Subscribe to changes and log them continuously.
     */
    subscribe(telemetry: Telemetry): void;
}
