import { Telemetry } from "../../core/telemetry";

export class CrashHandlerNative {
    constructor(private telemetry: Telemetry) { }

    attach() {
        // JS errors in React Native
        if (typeof ErrorUtils !== "undefined" && ErrorUtils.setGlobalHandler) {
            const defaultHandler = ErrorUtils.getGlobalHandler?.();

            ErrorUtils.setGlobalHandler((error: any, isFatal?: boolean) => {
                this.telemetry.log("app.crash", {
                    message: error?.message,
                    stacktrace: error?.stack,
                    fatal: isFatal,
                });

                // Call original handler (to keep RN red screen in dev)
                if (defaultHandler) {
                    defaultHandler(error, isFatal);
                }
            });
        }

        // Unhandled promise rejections
        const rejectionHandler = (event: any) => {
            this.telemetry.log("app.error", {
                message: event?.reason?.message ?? "Unhandled Promise Rejection",
                stacktrace: event?.reason?.stack,
            });
        };

        if (globalThis.addEventListener) {
            globalThis.addEventListener("unhandledrejection", rejectionHandler);
        } else {
            // fallback: monkey patch promise rejection tracking
            const tracking = require("promise/setimmediate/rejection-tracking");
            tracking.enable({
                allRejections: true,
                onUnhandled: (id: any, error: any) => {
                    this.telemetry.log("app.error", {
                        message: error?.message,
                        stacktrace: error?.stack,
                    });
                },
            });
        }
    }
}
