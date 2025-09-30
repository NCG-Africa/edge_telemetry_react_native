import { Telemetry } from '../core/telemetry';
export declare class NavigationTracker {
    private telemetry;
    constructor(telemetry: Telemetry);
    recordRouteChange(from: string, to: string): void;
}
