/**
 * §4.7 — the error surface. Two event names, not one: `app.crash` is unhandled /
 * fatal-ish, `app.error` is handled or non-fatal, so
 * `COUNT(event_name='app.crash') / sessions` is a crash-free rate with no `WHERE`
 * clause anyone can forget. All five v3 `crash.*` keys are retired for dotted
 * `error.*`, and both explicit wire nulls go with them. #100
 */

import { isDev } from "../core/debug";

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
/** Breadcrumb text is not an error payload — 20 of these ride every `app.crash`. */
const CRUMB_MAX = 200;

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

/**
 * Half of real `catch` blocks receive a string or an axios rejection object, not an Error, so
 * `fallbackMessage` is consulted **only** when the thrown value carries nothing usable.
 */
function errorMessage(error: unknown, fallbackMessage?: unknown): string | undefined {
  if (typeof error === "string" && error !== "") return error;
  const m = (error as any)?.message;
  if (typeof m === "string" && m !== "") return m;
  if (fallbackMessage === undefined || fallbackMessage === null || fallbackMessage === "") return undefined;
  return String(fallbackMessage);
}

/**
 * §4.8's second consumer wiring step, said **once per process and only in dev**.
 *
 * RN 0.81.4 sets `Error.stackTraceLimit` nowhere, so V8's default of **10 frames** governs —
 * not the 2000-char cap, which holds ~26. Ten frames of an `unhandledrejection` can be
 * entirely library internals.
 *
 * ⚠ The SDK **never assigns it**. Raising it globally is an invisible mutation of the
 * consumer's runtime that makes every `new Error()` in their app more expensive and
 * unattributable to us — so this is an advisory, and the consumer's own line of code.
 *
 * Not behind `debug()`: a consumer who has not wired this up is precisely a consumer who
 * has not set `debug: true`. Same reasoning as §6.4's dev throw, one rung quieter — and the
 * one carve-out from the no-bare-console rule, recorded as such in CLAUDE.md.
 */
let advised = false;
function adviseStackTraceLimit(): void {
  // The flag is set only when the advice is actually *said*: burning it on a call made
  // before `__DEV__` is defined would silence a dev app for the rest of the process.
  if (advised || !isDev()) return;
  advised = true;
  console.warn(
    "[edge-telemetry] Error.stackTraceLimit is the engine default (10 frames on V8), which " +
    "truncates crash stacks well before the SDK's 2000-char cap. Set `Error.stackTraceLimit = 50` " +
    "in your app's entry file — the SDK will not set it for you.",
  );
}

/**
 * The `error.*` block for both event names. `error.handled` does not exist — the event name
 * carries that bit, and carrying both is a denormalization that can disagree. `error.fatal`
 * is passed only by the native build (§4.7: on web nothing is fatal).
 */
export function buildErrorAttributes(
  source: ErrorSource,
  error: unknown,
  opts: { fallbackMessage?: unknown; fatal?: boolean } = {},
): Record<string, any> {
  const attrs: Record<string, any> = {
    "error.type": cap(errorType(error), TYPE_MAX),
    "error.source": source,
  };

  const message = errorMessage(error, opts.fallbackMessage);
  if (message !== undefined) attrs["error.message"] = cap(message, MESSAGE_MAX);

  const stack = (error as any)?.stack;
  if (typeof stack === "string" && stack !== "") {
    attrs["error.stacktrace"] = cap(stack, STACK_MAX, true);
    // Here rather than at init: this is the one chokepoint every captured stack passes
    // through, so the advice arrives when a dev has a real, already-truncated stack in front
    // of them — and #23's "construct → log → flush is silent by default" stays intact.
    adviseStackTraceLimit();
  }

  if (opts.fatal !== undefined) attrs["error.fatal"] = opts.fatal;
  return attrs;
}

/** What `captureConsole` needs of a `Telemetry` — structural. */
type ErrorSink = {
  captureError(error: unknown, context?: Record<string, any>, source?: ErrorSource): unknown;
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

  // Through captureError, not log(), so the `error.fatal` platform rule stays in one place.
  target.error = guarded(
    (text) => telemetry.captureError(text, undefined, "console"),
    origError,
  );
  target.warn = guarded(
    // Capped here, not at the ring: 20 uncapped React warnings would put kilobytes of
    // `error.breadcrumbs` on every `app.crash`, which is the budget this split exists to protect.
    (text) => telemetry.addBreadcrumb("console.warn", { message: cap(text, CRUMB_MAX) }),
    origWarn,
  );

  return () => { target.error = origError; target.warn = origWarn; };
}
