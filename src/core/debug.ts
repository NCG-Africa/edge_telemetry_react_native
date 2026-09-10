// SDK-internal debug gate (#23, Workstream E). Silent by default so v3 never spams the
// host app's console; `createTelemetry({ debug: true })` flips it on. Gates log AND
// warn/error — nothing prints unless debug is enabled.
let enabled = false;

export function setDebug(on: boolean): void {
  enabled = on;
}

export const debug = {
  log: (...args: any[]) => { if (enabled) console.log(...args); },
  warn: (...args: any[]) => { if (enabled) console.warn(...args); },
  error: (...args: any[]) => { if (enabled) console.error(...args); },
};

/**
 * `__DEV__` on RN, `NODE_ENV` elsewhere. Dev-only *config* diagnostics (a malformed
 * allowlist, the `Error.stackTraceLimit` advisory) surface through this rather than the
 * `debug` gate above: they are wiring mistakes the consumer has to see while building,
 * and `debug: true` is exactly what a consumer with a wiring mistake has not set.
 */
export function isDev(): boolean {
  const dev = (globalThis as any).__DEV__;
  if (typeof dev === "boolean") return dev;
  const env = (globalThis as any).process?.env?.NODE_ENV;
  return env !== undefined && env !== "production";
}
