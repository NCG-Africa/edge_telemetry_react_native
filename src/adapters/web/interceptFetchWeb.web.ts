// interceptHttp.web.ts
import { Telemetry } from "../../core/telemetry";

/**
 * NetworkTrackerWeb intercepts all HTTP requests made through
 * `window.fetch` and `XMLHttpRequest` in a browser environment.
 * 
 * It logs detailed telemetry data such as request URL, HTTP method,
 * response status, request and response body sizes, request duration,
 * and error information, if any.
 * 
 * This class should be instantiated once and the `start` method called
 * during application initialization to begin interception.
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
     * This method patches the global `fetch` function and `XMLHttpRequest` methods
     * `open` and `send` to gather telemetry and log it asynchronously.
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

                    // Estimate request body size if it's a string (ignoring complex types like FormData)
                    let requestBodySize = 0;
                    if (init?.body && typeof init.body === "string") {
                        requestBodySize = init.body.length;
                    }

                    // Attempt to get response size via Content-Length header
                    const responseBodySize = response
                        ? Number(response.headers.get("content-length") ?? 0)
                        : 0;

                    telemetry.log("network_request", {
                        url,
                        method: init?.method ?? "GET",
                        statusCode: response?.status ?? 0,
                        durationMs: end - start,
                        requestBodySize,
                        responseBodySize,
                        error: error ? String(error) : null,
                    });
                }
            };

            // --- Patch XMLHttpRequest methods ---
            const origOpen = XMLHttpRequest.prototype.open;
            const origSend = XMLHttpRequest.prototype.send;

            /**
             * Patch XMLHttpRequest.open to capture HTTP method and URL.
             * Stores telemetry data on the XMLHttpRequest instance.
             */
            XMLHttpRequest.prototype.open = function (
                method: string,
                url: string,
                async?: boolean,
                user?: string | null,
                password?: string | null
            ) {
                // Store telemetry info on the xhr instance
                (this as any)._telemetry = {
                    method,
                    url,
                    start: 0,
                };
                return origOpen.apply(this, arguments as any);
            };

            /**
             * Patch XMLHttpRequest.send to start timing and listen for completion.
             * Logs telemetry when the request finishes.
             */
            XMLHttpRequest.prototype.send = function (body?: Document | BodyInit | null) {
                const t = (this as any)._telemetry;
                t.start = Date.now();

                this.addEventListener("loadend", () => {
                    const end = Date.now();
                    const durationMs = end - t.start;

                    // Estimate request body size if it's a string
                    let requestBodySize = 0;
                    if (body && typeof body === "string") {
                        requestBodySize = body.length;
                    }

                    const responseBodySize = Number(this.getResponseHeader("content-length") ?? 0);

                    telemetry.log("network_request", {
                        url: t.url,
                        method: t.method,
                        statusCode: this.status,
                        durationMs,
                        requestBodySize,
                        responseBodySize,
                        error: this.status === 0 ? "Network error" : null,
                    });
                });

                return origSend.apply(this, arguments as any);
            };

            // Resolve immediately since interception setup is synchronous
            resolve();
        });
    }
}
