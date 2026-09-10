import { Telemetry } from "../core/telemetry";
import { buildHttpAttributes } from "./httpAttributes";

/**
 * Patches an `XMLHttpRequest` prototype so every completed request emits one `http.request`.
 * Shared because the native build is XHR-*only* (§4.4: RN's `global.fetch` is XHR underneath,
 * so patching both emits two events per call) while the web build patches XHR alongside its
 * own `fetch` patch — same emit rules, two different sets of callers.
 *
 * @returns the unpatch, so `stop()` can restore the prototype.
 */
export function patchXHR(telemetry: Telemetry, xhr: any): () => void {
    const origOpen = xhr.prototype.open;
    const origSend = xhr.prototype.send;

    xhr.prototype.open = function (this: any, method: string, url: string) {
        this._telemetry = { method, url, start: 0 };
        return origOpen.apply(this, arguments as any);
    };

    xhr.prototype.send = function (this: any, body?: any) {
        const t = this._telemetry;
        if (!t) return origSend.apply(this, arguments as any);  // send() without open() — let it throw its own way
        t.start = Date.now();

        this.addEventListener("loadend", () => {
            // Invariant: an http.request never describes the SDK's own collector POST.
            const endpoint = telemetry.getEndpoint?.();
            if (endpoint && String(t.url).startsWith(endpoint)) return;

            // absent content-length → omitted; a real "0" ships
            const len = this.getResponseHeader ? this.getResponseHeader("content-length") : null;

            telemetry.log("http.request", buildHttpAttributes({
                url: String(t.url),
                method: t.method,
                statusCode: this.status,
                durationMs: Date.now() - t.start,
                error: this.status === 0 ? "Network error" : null,
                requestBody: body,
                responseSize: len == null || len === "" ? undefined : Number(len),
            }));
        });

        return origSend.apply(this, arguments as any);
    };

    return () => { xhr.prototype.open = origOpen; xhr.prototype.send = origSend; };
}
