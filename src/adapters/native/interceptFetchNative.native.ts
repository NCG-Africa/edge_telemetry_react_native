// interceptFetch.native.ts
import { Telemetry } from "../../core/telemetry";

export function interceptFetch(telemetry: Telemetry) {
    const originalFetch = global.fetch;

    global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
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
            const durationMs = end - start;

            telemetry.log("network_request", {
                url: typeof input === "string" ? input : input.toString(),
                method: init?.method ?? "GET",
                statusCode: response?.status ?? 0,
                durationMs,
                requestBodySize: init?.body ? JSON.stringify(init.body).length : 0,
                responseBodySize: response
                    ? Number(response.headers.get("content-length") ?? 0)
                    : 0,
                error: error ? String(error) : null,
            });
        }
    };
}
