// Shared http.request attribute builder — the single source of truth so the web fetch patch
// and the shared XHR patch stay in lockstep on the v4 wire contract (§4.4, #95).
//
// `http.url` and `http.path` are gone outright (§9.1): the identifier lives in the path, so
// query-stripping would not have addressed the threat. `http.host` + `http.route` replace them,
// and the route template is normalized here, SDK-side — nothing raw ever leaves the device.

const MAX_ROUTE_DEPTH = 6;

// contract §4.4.1, verbatim. This is the decision, not an illustration — do not "improve" it.
function isVariable(s: string): boolean {
    if (/^v\d+$/i.test(s)) return false;  // version carve-out: /v2/ survives
    if (/\d/.test(s)) return true;        // any digit
    return s.length >= 32;                // opaque all-alpha token / dashless UUID
}

/**
 * Path → route template. `/` stays `/`, no case folding, trailing slash dropped, depth capped
 * at 6 segments with a trailing `/…`. No cardinality guard: a client-side rolling collapse
 * would make one row mean different things on different phones.
 */
export function normalizeRoute(path: string): string {
    const segments = path.split("/").filter((s) => s !== "");
    if (segments.length === 0) return "/";
    const kept = segments.slice(0, MAX_ROUTE_DEPTH).map((s) => (isVariable(s) ? "{id}" : s));
    const route = "/" + kept.join("/");
    return segments.length > MAX_ROUTE_DEPTH ? route + "/…" : route;
}

/** UTF-8 byte length. v3 shipped `String.length` — UTF-16 code units, 2-3× short on non-ASCII. */
export function utf8Bytes(s: string): number {
    let n = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c < 0x80) n += 1;
        else if (c < 0x800) n += 2;
        else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
            const lo = s.charCodeAt(i + 1);
            if (lo >= 0xdc00 && lo <= 0xdfff) { n += 4; i++; } else n += 3;  // lone surrogate → U+FFFD
        } else n += 3;
    }
    return n;
}

/**
 * Body size for every type measurable **without consuming the body**. `FormData` and streams
 * return undefined and the key is omitted — draining a consumer's request body is a far worse
 * bug than a missing key.
 */
export function requestBodySize(body: unknown): number | undefined {
    if (typeof body === "string") return utf8Bytes(body);
    if (body instanceof ArrayBuffer) return body.byteLength;
    if (ArrayBuffer.isView(body)) return body.byteLength;              // TypedArray | DataView
    if (typeof Blob !== "undefined" && body instanceof Blob) return body.size;
    return undefined;
}

// host keeps the port (deliberately unlike §6.4's trace gate); omitted on a relative URL.
function splitUrl(url: string): { host?: string; path: string } {
    try {
        const u = new URL(url);
        return { host: u.host, path: u.pathname };
    } catch {
        // native relative URL: no host to report, but the path is still routable
        const path = url.split("#")[0].split("?")[0];
        return { path: path.startsWith("/") ? path : "/" + path };
    }
}

export function buildHttpAttributes(args: {
    url: string;
    method: string;
    statusCode: number;
    durationMs: number;
    error?: unknown;
    requestBody?: unknown;
    responseSize?: number;
}): Record<string, any> {
    const { url, method, statusCode, durationMs, error, requestBody, responseSize } = args;
    const { host, path } = splitUrl(url);

    const attrs: Record<string, any> = {
        // uppercased here, reporting-only — the forwarded request is never touched (§9.5)
        "http.method": String(method || "GET").toUpperCase(),
        "http.status_code": statusCode,   // 0 = never got a response: DNS/TLS/timeout/abort
        "http.duration_ms": durationMs,
        "http.success": !error && statusCode >= 200 && statusCode < 400,
        "http.route": normalizeRoute(path),
    };
    if (host) attrs["http.host"] = host;

    const reqSize = requestBodySize(requestBody);
    if (reqSize !== undefined) attrs["http.request_size"] = reqSize;
    // omitted when unmeasurable, but a real 0 ships
    if (typeof responseSize === "number" && Number.isFinite(responseSize)) {
        attrs["http.response_size"] = responseSize;
    }

    return attrs;
}
