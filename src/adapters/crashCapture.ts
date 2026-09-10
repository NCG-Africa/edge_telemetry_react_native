/**
 * §4.7 — the error surface. Two event names, not one: `app.crash` is unhandled /
 * fatal-ish, `app.error` is handled or non-fatal, so
 * `COUNT(event_name='app.crash') / sessions` is a crash-free rate with no `WHERE`
 * clause anyone can forget. All five v3 `crash.*` keys are retired for dotted
 * `error.*`, and both explicit wire nulls go with them. #100
 */

/** `error.source` — a full re-cut of v3's `crash.cause`, not a rename. 5 values. */
export type ErrorSource =
  | "global_handler"
  | "unhandled_rejection"
  | "cross_origin"        // web only: window.onerror with error === undefined
  | "console"             // now on app.error
  | "reported";           // captureError()

// §4.7 caps. The stacktrace's 2000 is a tuning knob, not a contractual constant —
// it may be tight for Hermes, where the bytecode offset is the whole signal.
const TYPE_MAX = 255;
const MESSAGE_MAX = 1000;
const STACK_MAX = 2000;

/** Marked inline: no key, countable with a `LIKE`, zero schema. */
const TRUNCATED = "\n… [truncated]";

/**
 * Drops the tail, never the head — the top frames *are* the grouping input.
 *
 * ⚠ `frameBoundary` is not cosmetic. On Hermes `line` is a constant 1 and the bytecode
 * offset carries the location, so a cut mid-frame turns `at p (address at bundle:1:132161)`
 * into `…bundle:1:13` — which resolves to a **different, wrong** place rather than failing.
 */
function cap(value: string, max: number, frameBoundary = false): string {
  if (value.length <= max) return value;
  let cut = value.slice(0, max - TRUNCATED.length);
  if (frameBoundary) {
    const nl = cut.lastIndexOf("\n");
    if (nl > 0) cut = cut.slice(0, nl);
  }
  return cut + TRUNCATED;
}

/**
 * `error.type` is read from `error.name` **only, never `constructor.name`**: RN production
 * bundles minify class names, so `class PaymentError extends Error {}` would report as `"a"`
 * — not merely unreadable but *unstable across builds*, refragmenting grouping on every
 * deploy. `error.name` is a string literal in the author's source. Un-named classes report
 * `"Error"`: low cardinality, but honest.
 */
export function errorType(error: unknown): string {
  const name = (error as any)?.name;
  return typeof name === "string" && name !== "" ? name : "Error";
}

/** Half of real `catch` blocks receive a string or an axios rejection object, not an Error. */
function errorMessage(error: unknown, fallback?: unknown): string | undefined {
  if (typeof error === "string" && error !== "") return error;
  const m = (error as any)?.message;
  if (typeof m === "string" && m !== "") return m;
  if (fallback === undefined || fallback === null || fallback === "") return undefined;
  return String(fallback);
}

/**
 * The `error.*` block for both event names. `error.handled` does not exist — the event name
 * carries that bit, and carrying both is a denormalization that can disagree. `error.fatal`
 * is passed only by the native build (§4.7: on web nothing is fatal).
 */
export function buildErrorAttributes(
  source: ErrorSource,
  error: unknown,
  opts: { message?: unknown; fatal?: boolean } = {},
): Record<string, any> {
  const attrs: Record<string, any> = {
    "error.type": cap(errorType(error), TYPE_MAX),
    "error.source": source,
  };

  const message = errorMessage(error, opts.message);
  if (message !== undefined) attrs["error.message"] = cap(message, MESSAGE_MAX);

  const stack = (error as any)?.stack;
  if (typeof stack === "string" && stack !== "") {
    attrs["error.stacktrace"] = cap(stack, STACK_MAX, true);
  }

  if (opts.fatal !== undefined) attrs["error.fatal"] = opts.fatal;
  return attrs;
}

/** What `captureConsole` needs of a `Telemetry` — structural, so this file imports nothing. */
type ErrorSink = {
  log(name: string, data?: Record<string, any>): unknown;
  addBreadcrumb(name: string, data?: Record<string, any>): void;
};

/**
 * Patch console.error → `app.error` (source `console`) and console.warn → a **breadcrumb**.
 * `ConsoleWarn` is deleted outright: React's own dev-mode warnings were the dominant
 * contributor to v3's crash count, which is what made "is my app crashing more?"
 * unanswerable. Opt-*in* now — `captureConsole` defaults off (§4.7).
 *
 * Returns a restore fn. A reentrancy guard keeps the SDK's own console writes during
 * logging from re-capturing.
 */
export function captureConsole(
  telemetry: ErrorSink,
  target: Pick<Console, "error" | "warn"> = console,
): () => void {
  const origError = target.error.bind(target);
  const origWarn = target.warn.bind(target);
  let inside = false;

  const guarded = (emit: (text: string) => void, orig: (...a: any[]) => void) =>
    (...args: any[]) => {
      if (!inside) {
        inside = true;
        try {
          emit(args.map(String).join(" "));
        } finally {
          inside = false;
        }
      }
      orig(...args);
    };

  target.error = guarded(
    (text) => telemetry.log("app.error", buildErrorAttributes("console", undefined, { message: text })),
    origError,
  );
  target.warn = guarded(
    (text) => telemetry.addBreadcrumb("console.warn", { message: text }),
    origWarn,
  );

  return () => { target.error = origError; target.warn = origWarn; };
}
