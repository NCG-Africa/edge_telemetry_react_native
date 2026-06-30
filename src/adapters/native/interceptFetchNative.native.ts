import { Telemetry } from "../../core/telemetry";
import { buildHttpAttributes } from "../httpAttributes";

/**
 * Intercepts global `fetch` calls in React Native to log detailed telemetry data
 * about network requests, including timing, method, status, payload sizes, and errors.
 *
 * Use the `start()` method to begin interception.
 */
export class NetworkTrackerNative {
    private originalFetch: typeof fetch;

    constructor(private telemetry: Telemetry) {
        this.originalFetch = global.fetch.bind(global);
    }

    /**
     * Starts intercepting global fetch requests.
     * Wraps `global.fetch` with telemetry logging.
     *
     * @returns Promise<void> resolves immediately after interception is set up.
     */
    public start(): Promise<void> {
        return new Promise((resolve) => {
            global.fetch = async (
                input: string | URL | Request,
                init?: RequestInit
            ): Promise<Response> => {
                const start = Date.now();
                let response: Response | null = null;
                let error: unknown = null;

                try {
                    response = await this.originalFetch(input, init);
                    return response;
                } catch (err) {
                    error = err;
                    throw err;
                } finally {
                    const end = Date.now();
                    const durationMs = end - start;

                    const url = typeof input === "string" ? input : input.toString();

                    // Never self-capture the SDK's own collector POST
                    const endpoint = this.telemetry.getEndpoint?.();
                    if (!(endpoint && url.startsWith(endpoint))) {
                        const responseSize = response
                            ? Number(response.headers.get("content-length") ?? 0)
                            : 0;

                        this.telemetry.log("http.request", buildHttpAttributes({
                            url,
                            method: init?.method ?? "GET",
                            statusCode: response?.status ?? 0,
                            durationMs,
                            error,
                            requestBody: init?.body,
                            responseSize,
                        }));
                    }
                }
            };

            resolve();
        });
    }

    /**
     * Restores the original fetch function, removing the interception.
     */
    public stop(): void {
        global.fetch = this.originalFetch;
    }
}
