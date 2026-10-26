import { Telemetry } from "../../core/telemetry";
import { buildErrorAttributes, captureConsole, isBoundaryCaught } from "../crashCapture";
import { isDev } from "../../core/debug";

export type CrashHandlerOptions = { captureConsole?: boolean };

export class CrashHandler {
    constructor(private telemetry: Telemetry) { }

    // Lockstep with native: JS errors and unhandled rejections become `app.crash`;
    // console.error becomes `app.error` and console.warn a breadcrumb, both opt-in. §4.7, #100
    attach(options: CrashHandlerOptions = {}): Promise<void> {
        const { captureConsole: consoleEnabled = false } = options;
        return new Promise((resolve, reject) => {
            try {
                const report = (msg: string | Event, error: unknown) => {
                    // React's dev build rethrows a boundary-caught error here; it is already a row (#166).
                    if (isBoundaryCaught(error)) return;
                    // ⚠ `error === undefined` is the cross-origin instrumentation gap, not a
                    // mystery Error: a bundle served from a CDN without CORS headers yields the
                    // classic "Script error." with no stack. Naming it beats collapsing it.
                    const source = error ? "global_handler" : "cross_origin";
                    // No `fatal` on web — nothing here is fatal, the page keeps running (§4.7).
                    this.telemetry.log("app.crash", buildErrorAttributes(source, error, { fallbackMessage: msg }));
                };
                window.onerror = (msg, _url, _line, _col, error) => {
                    // React ≤18's dev build replays a failed render through invokeGuardedCallback, so
                    // this fires *before* getDerivedStateFromError marks the error — later in the same
                    // render. One macrotask lets the mark land. Dev only: production React never
                    // replays, and the production crash path stays synchronous.
                    if (error && !isBoundaryCaught(error) && isDev()) setTimeout(() => report(msg, error), 0);
                    else report(msg, error);
                };

                window.onunhandledrejection = (event) => {
                    if (isBoundaryCaught(event.reason)) return;
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
