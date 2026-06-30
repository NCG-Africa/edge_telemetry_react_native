import { Telemetry } from "../core/telemetry";

export class ScreenTimingTracker {
    private telemetry: Telemetry;
    private startTimes: Map<string, number> = new Map();
    private lastScreen?: string;

    constructor(telemetry: Telemetry) {
        this.telemetry = telemetry;
    }

    // Screen entry → v3 `navigation` (replaces v2 screen_view). Baseline shape follows the
    // reference/Angular keys; iOS reconciliation is OPEN (see additions ledger).
    startScreen(screen: string) {
        this.startTimes.set(screen, Date.now());
        this.telemetry.log("navigation", {
            "navigation.from_screen": this.lastScreen ?? null,
            "navigation.to_screen": screen,
            "navigation.method": "screen_start",
            "navigation.route_type": "screen",
        });
        this.lastScreen = screen;
    }

    // Screen exit → v3 `screen.duration` with dwell ms (replaces screen_end + performance.screen_duration).
    endScreen(screen: string) {
        const start = this.startTimes.get(screen);
        if (!start) return;

        const duration = Date.now() - start;
        this.startTimes.delete(screen);

        this.telemetry.log("screen.duration", {
            "screen.name": screen,
            "screen.duration_ms": duration,
            "screen.exit_method": "navigation",
        });
    }
}
