import { Telemetry } from '../../core/telemetry';
/**
 * Hook into React Navigation events
 * Usage: pass your navigationContainerRef
 */
export declare class NavigationTrackerNative {
    private tracker;
    private currentRoute?;
    constructor(telemetry: Telemetry);
    attach(navigationRef: any): void;
    private getActiveRouteName;
}
