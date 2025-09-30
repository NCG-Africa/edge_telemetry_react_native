import { Telemetry } from "../../core/telemetry";

export class FrameDropTrackerWeb {
    private telemetry: Telemetry;
    private lastFrame = performance.now();

    constructor(telemetry: Telemetry) {
        this.telemetry = telemetry;
    }

    start() {
        const loop = (time: number) => {
            const delta = time - this.lastFrame;
            this.lastFrame = time;

            const budget = 1000 / 60; // 60 FPS target
            if (delta > budget * 2) {
                const severity =
                    delta > budget * 3 ? "high" : delta > budget * 2 ? "medium" : "low";

                this.telemetry.log("frame_drop", {
                    "frame.delta_ms": delta,
                    "frame.target_fps": 60,
                    "frame.severity": severity,
                });
            }

            requestAnimationFrame(loop);
        };

        requestAnimationFrame(loop);
    }
}
