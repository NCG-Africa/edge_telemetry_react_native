import { Telemetry } from "../../core/telemetry";

export class CrashHandler {
    constructor(private telemetry: Telemetry) { }

    attach() {
        window.onerror = (msg, url, line, col, error) => {
            this.telemetry.log("app.crash", {
                message: msg,
                url,
                line,
                col,
                stacktrace: error?.stack,
            });
        };

        window.onunhandledrejection = (event) => {
            this.telemetry.log("app.error", {
                message: event.reason?.message,
                stacktrace: event.reason?.stack,
            });
        };
    }
}
