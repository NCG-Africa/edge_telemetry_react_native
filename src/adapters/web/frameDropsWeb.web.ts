import { Telemetry } from "../../core/telemetry";

interface FrameDropEvent {
    "frame.delta_ms": number;
    "frame.target_fps": number;
    "frame.severity": "low" | "medium" | "high";
}

/**
 * Tracks frame drops in web environments using requestAnimationFrame.
 * Assumes a default 60 FPS and logs if a frame is significantly delayed.
 */
export class FrameDropTrackerWeb {
    private lastFrameTime = performance.now();
    private readonly targetFPS: number;
    private readonly frameBudget: number;

    constructor(private telemetry: Telemetry, targetFPS = 60) {
        this.targetFPS = targetFPS;

        /**
         * Frame budget is the ideal time per frame in ms.
         * For 60 FPS: 1000ms / 60 = ~16.67ms per frame.
         */
        this.frameBudget = 1000 / this.targetFPS;
    }

    /**
     * Starts monitoring frame timing and logs significant drops.
     * Returns a Promise that resolves immediately for compatibility.
     */
    start(): Promise<void> {
        return new Promise((resolve) => {
            const loop = (currentTime: number) => {
                const delta = currentTime - this.lastFrameTime;
                this.lastFrameTime = currentTime;

                /**
                 * Detecting jank:
                 * - Low severity: just above 2x budget (~33ms)
                 * - Medium: above 2x but below 3x
                 * - High: >3x budget (~50ms+)
                 */
                if (delta > this.frameBudget * 2) {
                    let severity: FrameDropEvent["frame.severity"];

                    if (delta > this.frameBudget * 3) {
                        severity = "high";
                    } else if (delta > this.frameBudget * 2) {
                        severity = "medium";
                    } else {
                        severity = "low";
                    }

                    const event: FrameDropEvent = {
                        "frame.delta_ms": delta,
                        "frame.target_fps": this.targetFPS,
                        "frame.severity": severity,
                    };

                    this.telemetry.log("frame_drop", event);
                }

                requestAnimationFrame(loop);
            };

            // Kick off the monitoring loop
            requestAnimationFrame(loop);

            // Resolve immediately since the tracker runs in the background
            resolve();
        });
    }
}
