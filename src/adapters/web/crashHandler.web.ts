import { Telemetry } from "../../core/telemetry";
import { buildErrorAttributes, captureConsole } from "../crashCapture";

export type CrashHandlerOptions = { captureConsole?: boolean };

export class CrashHandler {
    constructor(private telemetry: Telemetry) { }

    // Lockstep with native: JS errors and unhandled rejections become `app.crash`;
    // console.error becomes `app.error` and console.warn a breadcrumb, both opt-in. §4.7, #100
    attach(options: CrashHandlerOptions = {}): Promise<void> {
        const { captureConsole: consoleEnabled = false } = options;
        return new Promise((resolve, reject) => {
            try {
                window.onerror = (msg, _url, _line, _col, error) => {
                    // ⚠ `error === undefined` is the cross-origin instrumentation gap, not a
                    // mystery Error: a bundle served from a CDN without CORS headers yields the
                    // classic "Script error." with no stack. Naming it beats collapsing it.
                    const source = error ? "global_handler" : "cross_origin";
                    // No `fatal` on web — nothing here is fatal, the page keeps running (§4.7).
                    this.telemetry.log("app.crash", buildErrorAttributes(source, error, { fallbackMessage: msg }));
                };

                window.onunhandledrejection = (event) => {
                    this.telemetry.log("app.crash", buildErrorAttributes("unhandled_rejection", event.reason, {
                        fallbackMessage: "Unhandled Promise Rejection",
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
