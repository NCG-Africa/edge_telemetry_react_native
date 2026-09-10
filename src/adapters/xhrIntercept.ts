import { Telemetry } from "../core/telemetry";
import type { LogSnapshot } from "../core/telemetry";
import { buildHttpAttributes, contentLengthSize, isCollectorUrl } from "./httpAttributes";
import type { TraceAttributes } from "./traceManager";
import { TRACEPARENT } from "./traceHeader";

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
    /**
     * Closes this request's contribution to §4.5.2's network settle. Bound at `send()` to the
     * view that was live *then*, so a response landing after a route change belongs to the view
     * it started in and does not hold the arriving one open.
     */
    settled?: (endedAt?: number) => void;
    /**
     * §6.3's Tier 1 keys, captured at `send()` so the parent is the root live *then* and
     * `span.start_time` is the send. Called at `loadend` to stamp `span.duration_ms` off
     * the same pair of timestamps `http.duration_ms` uses.
     */
    span?: (endedAt: number) => TraceAttributes;
    /**
     * §6.4's ownership flag: the consumer's own `traceparent`, recorded **at their write
     * time** in the `setRequestHeader` patch. Never inferred from the value's shape — an
     * SDK-minted and a consumer-minted header are byte-identical by construction — and reset
     * by `open()`, which per spec clears the author request headers anyway.
     */
    consumerTraceparent?: string;
    /**
     * §3.1's attribution freeze: `session.id`, `session.start_time` and `view.id` as they
     * were at `send()`. The 4-hour cap can rotate a session *while this request is in
     * flight*, which would otherwise put S1's trace on an S2 row. No `at` — the row still
     * reports its completion timestamp (§4.4).
     */
    snap?: LogSnapshot;
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
    // May legitimately be absent on a minimal XHR polyfill; when it is, there is no way to
    // observe a consumer header and no way to write ours, so tracing simply stays dark.
    const origSetRequestHeader = xhr.prototype.setRequestHeader;

    // `arguments` is forwarded verbatim on both hooks: the SDK reports on the request, it never
    // reshapes the one it passes on. That is the only reason for the two casts in this file.
    xhr.prototype.open = function (this: PatchedXhr, method: string, url: string | URL) {
        // An XHR may be legally re-opened before the previous request finished — and the old
        // PendingRequest is about to be dropped. Release its settle hold first, or the view it
        // started in can never go quiet and reports `abandoned` for the rest of its life.
        this._telemetryRequest?.settled?.();
        this._telemetryRequest = { method, url: String(url), start: 0 };
        return origOpen.apply(this, arguments as any);
    };

    if (origSetRequestHeader) {
        xhr.prototype.setRequestHeader = function (this: PatchedXhr, name: string, value: string) {
            // Read-scope (§6.4): **exactly one header name, for exactly one purpose** — a
            // presence check. Names are compared case-insensitively; no other header is
            // inspected, logged or forwarded, and this one is passed straight through.
            if (this._telemetryRequest && String(name).toLowerCase() === TRACEPARENT) {
                this._telemetryRequest.consumerTraceparent = value;
            }
            return origSetRequestHeader.apply(this, arguments as any);
        };
    }

    xhr.prototype.send = function (this: PatchedXhr, body?: Document | XMLHttpRequestBodyInit | null) {
        const req = this._telemetryRequest;
        if (!req) return origSend.apply(this, arguments as any);  // send() without open() — let it throw its own way
        req.start = Date.now();
        req.body = body;
        // The collector's own POST is out of scope for settle exactly as it is for
        // `http.request` — checked here as well as at loadend, because the view must not be
        // held open by the SDK's own traffic (§4.5.2).
        if (!isCollectorUrl(req.url, telemetry.getEndpoint?.())) {
            req.settled = telemetry.views.requestStarted(req.start);
            req.snap = telemetry.snapshot();
            // Mints a `request` root when nothing is live, and extends the live one otherwise
            // (§6.2), and resolves §6.5's outcome ladder. Same gate as settle: the SDK's own
            // POST neither holds a view open, starts an action, nor carries an outcome.
            // No `noCors` — `mode` is a fetch concept XHR cannot express, so `skipped_no_cors`
            // needs no platform branch to stay fetch-only.
            const trace = telemetry.trace.requestTrace(req.start, {
                url: req.url,
                sampled: telemetry.isSampled(),
                consumerTraceparent: req.consumerTraceparent,
            });
            req.span = trace.finish;
            // Written through the *original*, so our own write can never be misread as the
            // consumer's on a later inspection — and only ever when their flag is unset, so
            // there is no SDK-owned header for never-strip to have to protect.
            if (trace.header && origSetRequestHeader) {
                origSetRequestHeader.call(this, TRACEPARENT, trace.header);
            }
        }

        // One listener per *instance*, not per send: an XHR may be legally reused, and adding
        // a listener on every send() would emit N events on the Nth one. The handler reads
        // `_telemetryRequest` at fire time, so one listener serves every reuse.
        if (!this._telemetryListening) {
            this._telemetryListening = true;
            this.addEventListener("loadend", () => {
                const done = this._telemetryRequest;
                if (!done) return;
                done.settled?.();
                // Invariant: an http.request never describes the SDK's own collector POST.
                if (isCollectorUrl(done.url, telemetry.getEndpoint?.())) return;

                const end = Date.now();
                telemetry.log("http.request", {
                    ...buildHttpAttributes({
                        url: done.url,
                        method: done.method,
                        statusCode: this.status,
                        durationMs: end - done.start,
                        error: this.status === 0 ? "Network error" : null,
                        requestBody: done.body,
                        responseSize: contentLengthSize(this.getResponseHeader?.("content-length")),
                    }),
                    ...done.span?.(end),
                }, done.snap);
            });
        }

        try {
            return origSend.apply(this, arguments as any);
        } catch (err) {
            // A send() that throws never reaches `loadend`, so nothing else would ever close
            // this hold. The fetch half gets this from its `finally`; XHR needs it spelled out.
            req.settled?.();
            throw err;
        }
    };

    xhr[PATCHED] = true;
    return () => {
        xhr.prototype.open = origOpen;
        xhr.prototype.send = origSend;
        if (origSetRequestHeader) xhr.prototype.setRequestHeader = origSetRequestHeader;
        delete xhr[PATCHED];
    };
}
