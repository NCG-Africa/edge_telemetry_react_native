import { TelemetryWeb } from "./index.web";
import type { SyncStore } from "./core/store";
import type { BeforeSend } from "./core/beforeSend";
import { normalizeAllowlist } from "./adapters/traceHeader";
import { setDebug } from "./core/debug";

export type TelemetryOpts = {
    apiKey: string;             // required credential; must start with "edge_" (API key or JWT, #90)
    sender?: any;
    batchSize?: number;
    flushIntervalMs?: number;
    endpoint?: string;
    captureConsole?: boolean;   // funnel console.error/warn into app.crash (default on, opt-out)
    debug?: boolean;            // SDK-internal diagnostics; off by default (#23)
    store?: SyncStore;          // persisted-state port (#89); MUST be sync — see core/store.ts
    // Constructor-only (§3.6) — there is deliberately no runtime setter for either.
    beforeSend?: BeforeSend;      // sync scrubbing hook, run at enqueue over events and metrics
    sessionSampleRate?: number;   // 0.0-1.0, sticky per session, re-rolled at rotation; default 1
    // §6.4/#99. Bare hosts, exact match, **ports ignored** (a deliberate mismatch with
    // `http.host`, which keeps the port — do not join them). Empty by default: v4 is dark on
    // upgrade. Listing a host asserts that host's CORS allows `traceparent`; a malformed
    // entry throws in dev and is dropped in production.
    traceHostAllowlist?: string[];
};

// Deliberately loose: `apiKey` is the *credential*, and under AUTH_MODE=jwt it is
// `edge_<jwt>` — a shape the collector's >=3-`_`-part API-key check would reject. Tightening
// to that check here would hard-reject every JWT and make the segmented deployment
// unreachable, which is the exact bug #90 exists to close. Prefix + non-empty remainder is
// all we assert; the real catch is the 401 warn (contract §11.1).
export function assertApiKey(apiKey?: string) {
    if (!apiKey || !apiKey.startsWith("edge_")) {
        throw new Error("createTelemetry: apiKey is required and must start with 'edge_'");
    }
}

/**
 * Cross-platform factory for telemetry. The platform is chosen by the bundler
 * via the .web / .native file split — no runtime navigator sniffing.
 */
export function createTelemetry(opts: TelemetryOpts) {
    assertApiKey(opts?.apiKey);
    // §6.4's dev throw has to happen *here*, synchronously: the core Telemetry is built
    // inside `instancePromise`, which deliberately never rethrows, so a throw down there
    // would be a silently rejected promise instead of the loud config error dev asks for.
    // In production it drops the bad entry and reports through debug() — which is why the
    // gate has to be open first: the entry ctor's own setDebug() runs *after* this line, so
    // without this the production report would be a guaranteed no-op even with debug: true.
    // It runs again in TraceManager, where it is idempotent.
    setDebug(opts?.debug ?? false);
    normalizeAllowlist(opts?.traceHostAllowlist);
    return new TelemetryWeb(opts);
}
