// interceptHttp.web.ts
import { Telemetry } from "../../core/telemetry";
import { buildHttpAttributes, contentLengthSize, isCollectorUrl } from "../httpAttributes";
import { patchXHR } from "../xhrIntercept";

/**
 * NetworkTrackerWeb intercepts HTTP made through `window.fetch` and `XMLHttpRequest`.
 *
 * Both are patched here, unlike native: browser `fetch` is a native implementation, not
 * XHR-backed, so the two are genuinely separate channels and neither double-counts (§4.4).
 */
export class NetworkTrackerWeb {
    private telemetry: Telemetry;

    /**
     * Create a NetworkTrackerWeb instance.
     * @param telemetry - An instance of Telemetry used for logging network events.
     */
    constructor(telemetry: Telemetry) {
        this.telemetry = telemetry;
    }

    /**
     * Starts intercepting HTTP requests made through `fetch` and `XMLHttpRequest`.
     *
     * @returns A Promise that resolves immediately once interception is setup.
     */
    public start(): Promise<void> {
        return new Promise((resolve) => {
            // Capture telemetry instance to use inside patched functions
            const telemetry = this.telemetry;

            // --- Patch window.fetch ---
            const originalFetch = window.fetch;
            window.fetch = async (
                input: RequestInfo | URL,
                init?: RequestInit
            ): Promise<Response> => {
                const start = Date.now();
                let response: Response | null = null;
                let error: any = null;

                try {
                    response = await originalFetch(input, init);
                    return response;
                } catch (err) {
                    error = err;
                    throw err;
                } finally {
                    const end = Date.now();
                    const url = typeof input === "string" ? input : input.toString();

                    // Invariant: an http.request never describes the SDK's own collector POST.
                    if (!isCollectorUrl(url, telemetry.getEndpoint?.())) {
                        telemetry.log("http.request", buildHttpAttributes({
                            url,
                            method: init?.method ?? "GET",   // fetch's own default, a real observation
                            statusCode: response?.status ?? 0,
                            durationMs: end - start,
                            error,
                            requestBody: init?.body,
                            responseSize: contentLengthSize(response?.headers.get("content-length")),
                        }));
                    }
                }
            };

            // --- Patch XMLHttpRequest (absent in some RN-Web runtimes) ---
            if (typeof XMLHttpRequest !== "undefined") patchXHR(telemetry, XMLHttpRequest);

            // Resolve immediately since interception setup is synchronous
            resolve();
        });
    }
}
