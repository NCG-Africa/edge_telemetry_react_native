import { Telemetry } from '../../core/telemetry';
export declare class CrashHandler {
    private telemetry;
    constructor(telemetry: Telemetry);
    attach(): Promise<void>;
}
