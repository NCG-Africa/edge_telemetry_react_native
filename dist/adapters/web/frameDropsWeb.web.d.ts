import { Telemetry } from '../../core/telemetry';
/**
 * Tracks frame drops in web environments using requestAnimationFrame.
 * Assumes a default 60 FPS and logs if a frame is significantly delayed.
 */
export declare class FrameDropTrackerWeb {
    private telemetry;
    private lastFrameTime;
    private readonly targetFPS;
    private readonly frameBudget;
    constructor(telemetry: Telemetry, targetFPS?: number);
    /**
     * Starts monitoring frame timing and logs significant drops.
     * Returns a Promise that resolves immediately for compatibility.
     */
    start(): Promise<void>;
}
