// Shared http.request attribute builder — the single source of truth so the web and
// native fetch/XHR adapters stay in lockstep on the v3 contract (#25).
// Baseline keys are always present; iOS-parity additive keys ride only when honestly
// available (recorded in docs/backend-additions-ledger.md).
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

  const attrs: Record<string, any> = {
    "http.url": url,
    "http.method": method,
    "http.status_code": statusCode,
    "http.duration_ms": durationMs,
    "http.success": !error && statusCode >= 200 && statusCode < 400,
  };

  // additive — only emit what the platform actually exposes
  try {
    const u = new URL(url);
    attrs["http.host"] = u.host;
    attrs["http.path"] = u.pathname;
  } catch {
    // ponytail: relative/invalid URL → no host/path, baseline still ships
  }
  if (typeof requestBody === "string") attrs["http.request_size"] = requestBody.length;
  if (responseSize) attrs["http.response_size"] = responseSize;

  return attrs;
}
