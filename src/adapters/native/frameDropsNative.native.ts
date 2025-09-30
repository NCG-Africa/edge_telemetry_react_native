import { Telemetry } from "../../core/telemetry";

interface FrameDropEvent {
    "frame.delta_ms": number;
    "frame.target_fps": number;
    "frame.severity": "low" | "medium" | "high";
}

/**
 * Tracks frame drops in a React Native environment using requestAnimationFrame.
 * Assumes a target FPS (defaults to 60), and logs frames that exceed the expected budget.
 */
export class FrameDropTrackerNative {
    private lastFrameTime = performance.now();
    private readonly targetFPS: number;
    private readonly frameBudget: number;

    constructor(private telemetry: Telemetry, targetFPS = 60) {
        this.targetFPS = targetFPS;

        /**
         * Each frame should ideally complete in ~16.67ms (1000ms / 60fps).
         * This is known as the frame budget.
         * If delta exceeds 2x this budget, we consider it a frame drop.
         */
        this.frameBudget = 1000 / this.targetFPS;
    }

    /**
     * Starts tracking frame drops.
     * Returns a resolved Promise for compatibility with async startup flows.
     */
    start(): Promise<void> {
        return new Promise((resolve) => {
            const loop = () => {
                const now = performance.now();
                const delta = now - this.lastFrameTime;
                this.lastFrameTime = now;

                /**
                 * Detecting frame drops:
                 * If the time between frames (delta) is more than 2x the frame budget,
                 * we log it as a performance issue.
                 * 
                 * For 60fps:
                 * - Budget = ~16.67ms
                 * - Medium drop = >33ms
                 * - High drop = >50ms
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

            // Start the loop on the next animation frame
            requestAnimationFrame(loop);

            // Resolve immediately — the tracker runs continuously in background
            resolve();
        });
    }
}
