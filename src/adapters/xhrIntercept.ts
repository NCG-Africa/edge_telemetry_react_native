import { Telemetry } from "../core/telemetry";
import { buildHttpAttributes, contentLengthSize, isCollectorUrl } from "./httpAttributes";

// Double-patching is the exact defect #95 exists to kill: two patches mean two `loadend`
// listeners and two `http.request` events per call. `trackNetworkRequests()` is public and the
// entry ctors already call it once, so a second call must be a no-op. The flag rides the
// constructor, not the prototype, so it never leaks onto an instance.
const PATCHED = "__edgeTelemetryXhrPatched";

interface PendingRequest {
    method: string;
    url: string;
    start: number;
    body?: unknown;
}

interface PatchedXhr extends XMLHttpRequest {
    _telemetryRequest?: PendingRequest;
    _telemetryListening?: boolean;
}

type XhrCtor = { prototype: PatchedXhr; [PATCHED]?: boolean };

/**
 * Patches an `XMLHttpRequest` prototype so every completed request emits one `http.request`.
 * Shared because the native build is XHR-*only* (§4.4: RN's `global.fetch` is XHR underneath,
 * so patching both emits two events per call) while the web build patches XHR alongside its
 * own `fetch` patch — same emit rules, two different sets of callers.
 *
 * @returns the unpatch, so `stop()` can restore the prototype.
 */
export function patchXHR(telemetry: Telemetry, xhr: XhrCtor): () => void {
    if (xhr[PATCHED]) return () => { };

    const origOpen = xhr.prototype.open;
    const origSend = xhr.prototype.send;

    // `arguments` is forwarded verbatim on both hooks: the SDK reports on the request, it never
    // reshapes the one it passes on. That is the only reason for the two casts in this file.
    xhr.prototype.open = function (this: PatchedXhr, method: string, url: string | URL) {
        this._telemetryRequest = { method, url: String(url), start: 0 };
        return origOpen.apply(this, arguments as any);
    };

    xhr.prototype.send = function (this: PatchedXhr, body?: Document | XMLHttpRequestBodyInit | null) {
        const req = this._telemetryRequest;
        if (!req) return origSend.apply(this, arguments as any);  // send() without open() — let it throw its own way
        req.start = Date.now();
        req.body = body;

        // One listener per *instance*, not per send: an XHR may be legally reused, and adding
        // a listener on every send() would emit N events on the Nth one. The handler reads
        // `_telemetryRequest` at fire time, so one listener serves every reuse.
        if (!this._telemetryListening) {
            this._telemetryListening = true;
            this.addEventListener("loadend", () => {
                const done = this._telemetryRequest;
                if (!done) return;
                // Invariant: an http.request never describes the SDK's own collector POST.
                if (isCollectorUrl(done.url, telemetry.getEndpoint?.())) return;

                telemetry.log("http.request", buildHttpAttributes({
                    url: done.url,
                    method: done.method,
                    statusCode: this.status,
                    durationMs: Date.now() - done.start,
                    error: this.status === 0 ? "Network error" : null,
                    requestBody: done.body,
                    responseSize: contentLengthSize(this.getResponseHeader?.("content-length")),
                }));
            });
        }

        return origSend.apply(this, arguments as any);
    };

    xhr[PATCHED] = true;
    return () => {
        xhr.prototype.open = origOpen;
        xhr.prototype.send = origSend;
        delete xhr[PATCHED];
    };
}
