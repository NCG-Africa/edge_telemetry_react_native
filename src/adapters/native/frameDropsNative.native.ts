import { Telemetry } from "../../core/telemetry";

export class FrameDropTrackerNative {
    private telemetry: Telemetry;
    private lastFrame = Date.now();

    constructor(telemetry: Telemetry) {
        this.telemetry = telemetry;
    }

    start() {
        const loop = () => {
            const now = Date.now();
            const delta = now - this.lastFrame;
            this.lastFrame = now;

            const budget = 1000 / 60;
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
