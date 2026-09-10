import { Telemetry } from "../../core/telemetry";
import { buildErrorAttributes, captureConsole } from "../crashCapture";

export type CrashHandlerOptions = { captureConsole?: boolean };

export class CrashHandlerNative {
    constructor(private telemetry: Telemetry) { }

    // JS errors and unhandled rejections become `app.crash`; console.error becomes
    // `app.error` and console.warn a breadcrumb, both opt-in (default off). §4.7, #100
    attach(options: CrashHandlerOptions = {}): Promise<void> {
        const { captureConsole: consoleEnabled = false } = options;
        return new Promise((resolve, reject) => {
            try {
                if (typeof ErrorUtils !== "undefined" && ErrorUtils.setGlobalHandler) {
                    const defaultHandler = ErrorUtils.getGlobalHandler?.();
                    ErrorUtils.setGlobalHandler((error: any, isFatal?: boolean) => {
                        // `error.fatal` is native-only — the web build never passes it (§4.7).
                        this.telemetry.log("app.crash", buildErrorAttributes("global_handler", error, {
                            fatal: !!isFatal,
                        }));
                        if (defaultHandler) defaultHandler(error, isFatal);   // keep RN red screen in dev
                    });
                }

                const onRejection = (event: any) => {
                    this.telemetry.log("app.crash", buildErrorAttributes("unhandled_rejection", event?.reason, {
                        message: "Unhandled Promise Rejection",
                        fatal: false,
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
