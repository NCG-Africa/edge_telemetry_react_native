import { Telemetry } from '../core/telemetry';
export declare class ScreenTimingTracker {
    private telemetry;
    private startTimes;
    constructor(telemetry: Telemetry);
    startScreen(screen: string): void;
    endScreen(screen: string): void;
}
