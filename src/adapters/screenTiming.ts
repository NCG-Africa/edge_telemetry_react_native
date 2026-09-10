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
    async startScreen(screen: string) {
        const from = this.lastScreen;
        this.markStart(screen);   // emits nothing; synchronous so a tap right after this call sees it
        this.lastScreen = screen;
        // The deprecated row first, awaited: it describes the transition, so it belongs to
        // the view being left. Then the boundary — otherwise the two race and the
        // `navigation` row lands under whichever view the microtask queue happened to pick.
        await this.telemetry.log("navigation", {
            "navigation.from_screen": from ?? null,
            "navigation.to_screen": screen,
            "navigation.method": "screen_start",
            "navigation.route_type": "screen",
        });
        // Rung 1 of the name ladder (§4.5.1) — `explicit`, and never normalized: a host
        // naming a screen "Step 2 of 3" must not receive "Step {id} of {id}".
        await this.telemetry.enterView(screen, "explicit");
    }

    /**
     * Arm the dwell clock without emitting `navigation`. The route-change path (§4.11) has
     * already emitted its own `navigation` with `method: "push"`, and emitting a second one
     * with `method: "screen_start"` for the same transition would double the table.
     */
    markStart(screen: string) {
        this.startTimes.set(screen, Date.now());
        this.telemetry.currentScreen = screen;   // best-effort screen for user.interaction taps (#33)
    }

    // Screen exit → v3 `screen.duration` with dwell ms (replaces screen_end + performance.screen_duration).
    async endScreen(screen: string) {
        const start = this.startTimes.get(screen);
        if (!start) return;

        const duration = Date.now() - start;
        this.startTimes.delete(screen);

        await this.telemetry.log("screen.duration", {
            "screen.name": screen,
            "screen.duration_ms": duration,
            "screen.exit_method": "navigation",
        });
    }
}
