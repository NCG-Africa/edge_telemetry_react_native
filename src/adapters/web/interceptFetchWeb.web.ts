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
                const url = typeof input === "string" ? input : input.toString();
                const isCollector = isCollectorUrl(url, telemetry.getEndpoint?.());
                // Bound to the view live at *send*, not at completion (§4.5.2). The collector's
                // own POST is excluded from settle for the same reason it is excluded from
                // `http.request`: the SDK must not hold a view open with its own traffic.
                const settled = isCollector ? undefined : telemetry.views.requestStarted(start);
                // §6.3's Tier 1, captured at send for the same reason: the root live *now*
                // is the parent, and a root minted here is this request's own (§6.2).
                const span = isCollector ? undefined : telemetry.trace.requestSpan(start);
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
                    settled?.(end);

                    // Invariant: an http.request never describes the SDK's own collector POST.
                    if (!isCollector) {
                        telemetry.log("http.request", {
                            ...buildHttpAttributes({
                                url,
                                method: init?.method ?? "GET",   // fetch's own default, a real observation
                                statusCode: response?.status ?? 0,
                                durationMs: end - start,
                                error,
                                requestBody: init?.body,
                                responseSize: contentLengthSize(response?.headers.get("content-length")),
                            }),
                            ...span?.(end),
                        });
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
