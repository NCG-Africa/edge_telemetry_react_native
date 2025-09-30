import { Telemetry } from '../../core/telemetry';
/**
 * Tracks frame drops in a React Native environment using requestAnimationFrame.
 * Assumes a target FPS (defaults to 60), and logs frames that exceed the expected budget.
 */
export declare class FrameDropTrackerNative {
    private telemetry;
    private lastFrameTime;
    private readonly targetFPS;
    private readonly frameBudget;
    constructor(telemetry: Telemetry, targetFPS?: number);
    /**
     * Starts tracking frame drops.
     * Returns a resolved Promise for compatibility with async startup flows.
     */
    start(): Promise<void>;
}
