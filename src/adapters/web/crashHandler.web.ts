import { Telemetry } from "../../core/telemetry";

export class CrashHandler {
    constructor(private telemetry: Telemetry) { }

    attach(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                console.log("CrashHandlerWeb: attaching global error handlers");

                window.onerror = (msg, url, line, col, error) => {
                    console.log("CrashHandlerWeb: window.onerror caught");
                    this.telemetry.log("app.crash", {
                        message: msg,
                        url,
                        line,
                        col,
                        stacktrace: error?.stack,
                    });
                };

                window.onunhandledrejection = (event) => {
                    console.log("CrashHandlerWeb: onunhandledrejection event caught");
                    this.telemetry.log("app.error", {
                        message: event.reason?.message,
                        stacktrace: event.reason?.stack,
                    });
                };

                resolve();
            } catch (error) {
                reject(error);
            }
        });
    }
}
