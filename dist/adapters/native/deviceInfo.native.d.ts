import { Telemetry, DeviceInfo } from '../../core/telemetry';
export declare class DeviceInfoTrackerNative {
    constructor();
    collect(): Promise<DeviceInfo>;
    /**
     * Collects and logs the device/app metadata.
     */
    start(telemetry: Telemetry): Promise<void>;
}
