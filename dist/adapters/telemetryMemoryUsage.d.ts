import { Telemetry } from './../core/telemetry';
export declare class TelemetryMemoryUsage {
    private telemetry;
    constructor(telemetry: Telemetry);
    recordMemoryUsage(): void;
}
