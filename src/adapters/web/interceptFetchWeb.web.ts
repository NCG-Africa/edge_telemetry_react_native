// interceptHttp.web.ts
import { Telemetry } from "../../core/telemetry";

export function interceptHttp(telemetry: Telemetry) {
    // --- Patch fetch ---
    const originalFetch = window.fetch;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
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
            telemetry.log("network_request", {
                url: typeof input === "string" ? input : input.toString(),
                method: init?.method ?? "GET",
                statusCode: response?.status ?? 0,
                durationMs: end - start,
                requestBodySize: init?.body ? JSON.stringify(init.body).length : 0,
                responseBodySize: response
                    ? Number(response.headers.get("content-length") ?? 0)
                    : 0,
                error: error ? String(error) : null,
            });
        }
    };

    // --- Patch XMLHttpRequest ---
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (
        method: string,
        url: string,
        async?: boolean,
        user?: string | null,
        password?: string | null
    ) {
        (this as any)._telemetry = { method, url, start: 0 };
        return origOpen.apply(this, arguments as any);
    };

    XMLHttpRequest.prototype.send = function (body?: Document | BodyInit | null) {
        const t = (this as any)._telemetry;
        t.start = Date.now();

        this.addEventListener("loadend", () => {
            const end = Date.now();
            const durationMs = end - t.start;
            telemetry.log("network_request", {
                url: t.url,
                method: t.method,
                statusCode: this.status,
                durationMs,
                requestBodySize: body ? JSON.stringify(body).length : 0,
                responseBodySize: Number(this.getResponseHeader("content-length") ?? 0),
                error: this.status === 0 ? "Network error" : null,
            });
        });

        return origSend.apply(this, arguments as any);
    };
}
