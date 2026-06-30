import { Telemetry } from "../core/telemetry";

// One `app.crash` stream, segmented by cause (lifts the iOS ADR-010 model). #28
export type CrashCause = "Error" | "UnhandledRejection" | "ConsoleError" | "ConsoleWarn";

export function buildCrashAttributes(
  cause: CrashCause,
  fields: { message?: unknown; stacktrace?: unknown; fatal?: boolean } = {},
): Record<string, any> {
  const attrs: Record<string, any> = {
    "crash.cause": cause,
    "crash.message": fields.message ?? null,
    "crash.stacktrace": fields.stacktrace ?? null,
  };
  if (fields.fatal !== undefined) attrs["crash.fatal"] = fields.fatal;
  return attrs;
}

/**
 * Patch console.error/warn to funnel into `app.crash` (cause ConsoleError/ConsoleWarn).
 * Opt-out: callers only invoke this when console capture is enabled. Returns a restore fn.
 * A reentrancy guard prevents the SDK's own console writes during logging from re-capturing.
 */
export function captureConsole(
  telemetry: Telemetry,
  target: Pick<Console, "error" | "warn"> = console,
): () => void {
  const origError = target.error.bind(target);
  const origWarn = target.warn.bind(target);
  let inside = false;

  const make = (cause: CrashCause, orig: (...a: any[]) => void) =>
    (...args: any[]) => {
      if (!inside) {
        inside = true;
        try {
          telemetry.log("app.crash", buildCrashAttributes(cause, { message: args.map(String).join(" ") }));
        } finally {
          inside = false;
        }
      }
      orig(...args);
    };

  target.error = make("ConsoleError", origError);
  target.warn = make("ConsoleWarn", origWarn);

  return () => { target.error = origError; target.warn = origWarn; };
}
