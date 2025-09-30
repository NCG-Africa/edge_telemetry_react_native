import { Telemetry } from '../../core/telemetry';
export declare class CrashHandlerNative {
    private telemetry;
    constructor(telemetry: Telemetry);
    attach(): Promise<void>;
}
