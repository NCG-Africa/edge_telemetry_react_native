import { DeviceInfo, Telemetry } from '../../core/telemetry';
export declare class DeviceInfoTrackerWeb {
    private telemetry?;
    constructor();
    collect(): Promise<DeviceInfo>;
    start(telemetry: Telemetry): Promise<void>;
}
