import { Telemetry } from "../../core/telemetry";

export class CrashHandlerNative {
    constructor(private telemetry: Telemetry) { }

    attach(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                // JS errors in React Native
                console.log("CrashHandlerNative: attaching global error handlers");
                if (typeof ErrorUtils !== "undefined" && ErrorUtils.setGlobalHandler) {
                    console.log("CrashHandlerNative: ErrorUtils available, setting global handler");
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
                    console.log("CrashHandlerNative: unhandledrejection event caught");
                    this.telemetry.log("app.error", {
                        message: event?.reason?.message ?? "Unhandled Promise Rejection",
                        stacktrace: event?.reason?.stack,
                    });
                };

                if (globalThis.addEventListener) {
                    console.log("CrashHandlerNative: setting up global unhandledrejection listener");
                    globalThis.addEventListener("unhandledrejection", rejectionHandler);
                } else {
                    // fallback: monkey patch promise rejection tracking
                    console.log("CrashHandlerNative: addEventListener not available, using rejection-tracking");
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
                    console.log("CrashHandlerNative: rejection-tracking enabled");
                }

                resolve();
            } catch (error) {
                reject(error);
            }
        });
    }
}
