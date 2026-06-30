import { Telemetry } from "../../core/telemetry";
import { buildCrashAttributes, captureConsole } from "../crashCapture";

export type CrashHandlerOptions = { captureConsole?: boolean };

export class CrashHandler {
    constructor(private telemetry: Telemetry) { }

    // Lockstep with native: funnels JS errors, unhandled rejections and (opt-out)
    // console.error/warn into one `app.crash` stream keyed by `crash.cause`. #28
    attach(options: CrashHandlerOptions = {}): Promise<void> {
        const { captureConsole: consoleEnabled = true } = options;
        return new Promise((resolve, reject) => {
            try {
                window.onerror = (msg, _url, _line, _col, error) => {
                    this.telemetry.log("app.crash", buildCrashAttributes("Error", {
                        message: error?.message ?? msg,
                        stacktrace: error?.stack,
                    }));
                };

                window.onunhandledrejection = (event) => {
                    this.telemetry.log("app.crash", buildCrashAttributes("UnhandledRejection", {
                        message: event.reason?.message ?? "Unhandled Promise Rejection",
                        stacktrace: event.reason?.stack,
                    }));
                };

                if (consoleEnabled) captureConsole(this.telemetry);

                resolve();
            } catch (error) {
                reject(error);
            }
        });
    }
}
