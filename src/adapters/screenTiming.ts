import { Telemetry } from "../core/telemetry";

export class ScreenTimingTracker {
    private telemetry: Telemetry;
    private startTimes: Map<string, number> = new Map();

    constructor(telemetry: Telemetry) {
        this.telemetry = telemetry;
    }

    startScreen(screen: string) {
        this.startTimes.set(screen, Date.now());
        this.telemetry.log("screen_view", { "screen.name": screen });
    }

    endScreen(screen: string) {
        const start = this.startTimes.get(screen);
        if (!start) return;

        const duration = Date.now() - start;
        this.startTimes.delete(screen);

        this.telemetry.log("performance.screen_duration", {
            "screen.name": screen,
            "duration_ms": duration,
        });
    }
}
