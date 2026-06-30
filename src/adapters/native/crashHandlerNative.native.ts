import { Telemetry } from "../../core/telemetry";
import { buildCrashAttributes, captureConsole } from "../crashCapture";

export type CrashHandlerOptions = { captureConsole?: boolean };

export class CrashHandlerNative {
    constructor(private telemetry: Telemetry) { }

    // Funnels JS errors, unhandled rejections and (opt-out) console.error/warn into one
    // `app.crash` stream keyed by `crash.cause`. Console capture defaults on (opt-out). #28
    attach(options: CrashHandlerOptions = {}): Promise<void> {
        const { captureConsole: consoleEnabled = true } = options;
        return new Promise((resolve, reject) => {
            try {
                if (typeof ErrorUtils !== "undefined" && ErrorUtils.setGlobalHandler) {
                    const defaultHandler = ErrorUtils.getGlobalHandler?.();
                    ErrorUtils.setGlobalHandler((error: any, isFatal?: boolean) => {
                        this.telemetry.log("app.crash", buildCrashAttributes("Error", {
                            message: error?.message,
                            stacktrace: error?.stack,
                            fatal: isFatal,
                        }));
                        if (defaultHandler) defaultHandler(error, isFatal);   // keep RN red screen in dev
                    });
                }

                const onRejection = (event: any) => {
                    this.telemetry.log("app.crash", buildCrashAttributes("UnhandledRejection", {
                        message: event?.reason?.message ?? "Unhandled Promise Rejection",
                        stacktrace: event?.reason?.stack,
                    }));
                };

                if (globalThis.addEventListener) {
                    globalThis.addEventListener("unhandledrejection", onRejection);
                } else {
                    const tracking = require("promise/setimmediate/rejection-tracking");
                    tracking.enable({
                        allRejections: true,
                        onUnhandled: (_id: any, error: any) =>
                            onRejection({ reason: error }),
                    });
                }

                if (consoleEnabled) captureConsole(this.telemetry);

                resolve();
            } catch (error) {
                reject(error);
            }
        });
    }
}
