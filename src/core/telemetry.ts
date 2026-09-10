import { debug } from "./debug";
import { NavigationTracker } from "../adapters/navigationTracker";
import { ScreenTimingTracker } from "../adapters/screenTiming";
import { ViewManager, type ViewNameSource } from "../adapters/viewManager";
import { TraceManager } from "../adapters/traceManager";
import { BreadcrumbBuffer } from "./breadcrumbs";
import { buildErrorAttributes, type ErrorSource } from "../adapters/crashCapture";
import { randomHex } from "./utils/uuid";
import type { Store } from "./store";
import { memoryStore } from "./memoryStore";
import { applyBeforeSend, type BeforeSend } from "./beforeSend";
import { buildProfileAttributes } from "./userProfile";
import { stringifyOrDrop } from "./utils/json";
import { version as PKG_VERSION } from "../../package.json";

export type { BeforeSend } from "./beforeSend";
import type { Orientation } from "../adapters/viewport";
export type { Orientation };

// v3 wire contract constants
// §3.3 / §12's item 10 — `react-native-{Platform.OS}`, joining Flutter's `flutter-{os}` shape.
// ⚠ NOT a closed three-value enum: RN-Windows emits `react-native-windows`. The bare
// framework name survives only for a direct `new Telemetry()` with no entry-declared
// platform, which is the same gap `apiKey` already has.
const sdkPlatform = (platform?: string) => platform ? `react-native-${platform}` : "react-native";
const SDK_VERSION = PKG_VERSION;       // sdk.version follows the published package version
const SESSION_IDLE_MS = 30 * 60 * 1000; // rotate the session after 30 min of inactivity (iOS ADR-004)
// New in v4 (§4.2). Removing the process-death boundary lets a backgrounded app's
// http.request traffic hold one session open forever; this bounds length, not count.
const SESSION_MAX_MS = 4 * 60 * 60 * 1000;

// A cycle needs *a* bound, not a visited-set. Nothing on this wire nests past deviceInfo's
// two levels, so 8 is unreachable for a real payload and a cycle stops here (§4.10).
const FLATTEN_MAX_DEPTH = 8;

/**
 * The in-memory queue's cap (§9.4). Drop-oldest, `app.crash` evicted last: a long
 * offline period on an unbounded queue grows inside the host app's heap, and evicting
 * crashes first would make the crash-free rate read *better* the worse the network is.
 */
const QUEUE_MAX_EVENTS = 500;

/** `sdk.drop_reason` (§11). `rejected` has no producer until 4xx-drops-the-batch lands (#113). */
export type DropReason = "queue_full" | "store_full" | "rejected";

/**
 * Which row to evict to get back under a cap: the oldest non-crash, or — when every
 * row is a crash — the oldest, because growing past the cap is not an option either.
 *
 * Shared with the offline store (`adapters/failedEvents.ts`) so the in-memory queue and
 * the disk queue can never disagree about what survives.
 *
 * ponytail: O(n) scan per eviction, n <= 500. Track the first non-crash index if a
 * profile ever shows this on a hot path.
 */
/** An event's `event.sequence`, or -1 before `enqueue()` has stamped one. */
const seqOf = (e: TelemetryEvent): number => e.attributes?.['event.sequence'] ?? -1;

/**
 * §4.7's two error names. Both book `sdk.error_count` and `view.error_count` — a closed
 * enumeration, not resource failures and not `console.warn`. Only `app.crash` gets the
 * dedicated crash path and the eviction reprieve, which is the whole point of the split:
 * `COUNT(event_name='app.crash')` must stay a crash count nobody can forget to filter.
 */
export const isErrorName = (name?: string): boolean =>
    name === "app.crash" || name === "app.error";

export function evictIndex(events: TelemetryEvent[]): number {
    const i = events.findIndex(e => e.eventName !== "app.crash");
    return i === -1 ? 0 : i;
}

/** Store key for the self-minted, persisted `device.id` (#91). */
export const DEVICE_ID_KEY = "telemetry_device_id";
/** Store key for the resumable session record (#92). */
export const SESSION_KEY = "telemetry_session";

/** `session.reason` domains: 3 on session.started, the last 2 on session.finalized (§4.1/§4.2). */
export type SessionReason = "launch" | "idle" | "max_duration";
export type SessionEndReason = Exclude<SessionReason, "launch">;

/**
 * What survives process death, tab close, hard reload and bfcache restore (§4.2).
 * On web the Store is `localStorage`, so this record is browser-wide and shared
 * across tabs — intended, not a leak.
 */
type PersistedSession = {
    id: string;
    start: number;
    lastActivity: number;
    sequence: number;
    // Per-session, per-event ordinal (§2.4). Persisted for the same reason `sequence` is:
    // a resumed session restarting at 0 emits duplicate (session.id, event.sequence) pairs,
    // which is exactly the key the backend's dedup index is built on.
    eventSequence: number;
    eventCount: number;
    errorCount: number;
    // The sticky sample decision and the rate it was rolled at (§3.6). Both travel with
    // the session, because a resume is not a rotation — re-rolling on relaunch produces
    // a half-sampled session, and shipping the *current* config rate on a session rolled
    // at the old one makes every extrapolation off it wrong.
    sampled: boolean;
    sampleRate: number;
};

/** What hydration decided, so the emitting half stays free of storage concerns. */
type SessionHydration =
    | { kind: "resumed" }                                   // inside the idle window: no session.started (§4.1)
    | { kind: "nothing" }                                   // miss or unavailable — storage told us nothing
    | { kind: "expired"; reason: SessionEndReason };        // adopted, now owed a finalize + a fresh session
/** The collector caps `user.id` at 255; truncate at source rather than be rejected (§3.2). */
const USER_ID_MAX = 255;

// Names the backend routes. Anything else is remapped to `custom_event` with the
// original name carried as `event.name`. Includes metric names so the metric path
// (slice: native metrics) isn't remapped.
const ALLOWED_NAMES = new Set<string>([
    "session.started", "session.finalized", "app_lifecycle", "navigation",
    "screen.duration", "http.request", "network_change",
    "user.profile.update", "custom_event", "app.crash", "view",
    // ⚠ `app.error` needs backend allowlist sign-off before it ships (#100, §4.7).
    "app.error",
    // §4.6/#102 — replaces `user.interaction`, which is off the list as of v4. The
    // `rum_ui_interactions` columns are already built; the name still needs sign-off.
    "ui.interaction",
    // ⚠ `app.start` needs backend allowlist sign-off before it ships (#98, §4.3/§6.2) — an
    // unlisted eventName is dropped on ingest. It is listed here, so it is being emitted.
    "app.start",
    "frame_render_time", "memory_usage",
    "LCP", "FCP", "CLS", "INP", "TTFB",
    // ⚠ `page_load`, `resource_timing` and `long_task` are **retired, not deferred**
    // (§10.2, #109) — as `user.interaction` was in #102, four in total for a net-zero v4.
    // Do not add them back: `page_load`'s job is done three ways over (`view` +
    // `view.loading_time` + the vitals), `resource_timing` would blow the 500-event queue on
    // one asset-heavy view for a namespace with no column, and `long_task`'s only APIs are
    // Chromium-only while `frame_render_time` detects jank on every runtime. A name off this
    // list is rewritten to `custom_event`, so all four are unreachable, not merely unused.
]);

/**
 * §5.1's `metric.unit` — NULL on every RN row ever landed until v4. Without it a CLS of
 * `0.08` renders as a flat zero line beside an LCP of `4000` in the same `value` column,
 * so `score` for CLS is the key entry, not `ms`.
 *
 * A name absent from this map ships no unit: absent means the SDK had nothing, and a
 * consumer's own `recordMetric()` name has no unit we can honestly claim.
 */
const METRIC_UNIT: Record<string, string> = {
    frame_render_time: "ms",
    memory_usage: "MB",
    LCP: "ms", FCP: "ms", INP: "ms", TTFB: "ms",
    CLS: "score",
};

/**
 * §6.3's Tier 2 — annotation-only: `trace.id`, `rum.action.id` and `trace.root_type`, no
 * span. Stamped here because these rows have no earlier capture point; Tier 1 rows
 * (`app.start`, `view`, `http.request`) carry keys captured at launch / view entry / send
 * and hand them in as `data`, and everything else is Tier 3 — **trace-free, all metrics
 * included**. A windowed aggregate belongs to no single action, and a `rum.action.id` on
 * one would invite a `GROUP BY` over a number that was never attributable.
 *
 * ⚠ "% of errors attributed to an action" is bounded well below 100% by design: a consumer
 * calling `captureError()` from a background retry has no live root and gets no trace keys at
 * all. `ui.interaction` is Tier 1: its keys are captured at the click's
 * mint and handed in as `data`, like the other three.
 */
const TIER_2_NAMES = new Set<string>(["app.crash", "app.error", "custom_event"]);

/**
 * §4.6's mint/emit split, for the one event that has one. A `ui.interaction` is emitted
 * after its dead-click window, so its wire `timestamp` and its `view.id` / `view.name` /
 * `session.id` are snapshotted at the click and replayed here — otherwise a tap that
 * navigates is booked against the view it opened.
 */
export type LogSnapshot = {
    /**
     * Epoch ms of the click. Becomes the row's `timestamp`. **Omitted by a span-carrying row
     * that is not deferred** — an `http.request` freezes its *attribution* at send but still
     * reports the completion time §4.4 gives it.
     */
    at?: number;
    viewId: string;
    sessionId: string;
    /** Epoch ms — `session.start_time` freezes with the id it belongs to (§3.1). */
    sessionStart: number;
};

// Events carry `eventName`; metrics carry `metricName` + numeric `value` (v3 §"Event vs Metric").
// Kept as one loose shape (not a strict union) so callers can read `.eventName` without narrowing;
// the emit helpers (log / logMetric) set the right fields, and JSON.stringify drops the undefined ones.
export type TelemetryEvent = {
    type: 'event' | 'metric';
    eventName?: string;
    metricName?: string;
    value?: number;
    timestamp: string;          // ISO 8601 (v3 wire contract) — never ms epoch
    attributes?: Record<string, any>;
};

export interface Sender {
    send(events: TelemetryEvent[]): Promise<void>;
    /**
     * Persist a batch that could not be sent. Returns how many rows the offline store's
     * cap cost, so core can book them as `sdk.drop_reason = "store_full"` (§9.4) — the
     * counter lives on the Context block, which only core assembles. `void` is still a
     * valid return: a consumer's own sender is not obliged to have a cap.
     */
    onFailure?(events: TelemetryEvent[]): Promise<number | void>;
    replayFailed?(): Promise<void>;
}



export interface CrashHandlerOptions {
    // console.error -> app.error, console.warn -> a breadcrumb. Default OFF (§4.7, #100):
    // React's own dev-mode warnings dominated v3's crash count.
    captureConsole?: boolean;
}

export interface CrashHandler {
    attach(options?: CrashHandlerOptions): Promise<void>;
}
export interface NetworkInfo {
    type?: string;        // "wifi", "cellular", "ethernet", "unknown", etc.
    is_connected?: boolean;
}

export interface NetworkInfoHandler {
    start(telemetry: Telemetry): Promise<NetworkInfo>;
    collect(): Promise<NetworkInfo>;
}

export interface DeviceInfoHandler {
    start(telemetry: Telemetry): Promise<void>;
    collect(): Promise<DeviceInfo>;
}
export interface FrameDropsHandler {
    start(): Promise<void>;
}

export interface NetworkHandler {
    start(): Promise<void>;
}

export interface MemoryHandler {
    start(): Promise<void>;
    /** Torn down by `shutdown()`: unlike the rAF-driven trackers this one owns a timer. */
    stop?(): void;
}

export interface NavigationHandler {
    start(): Promise<void>;
}


export interface DeviceInfo {
    app: {
        name: string;
        version: string;
        build_number?: string;
        package_name?: string;
    };
    device: {
        // No `id` here (#91): core self-mints and persists device.id, and stamps it onto the
        // Context block *after* this block is flattened — an adapter-set id would be dead.
        platform: string;
        platform_version?: string;
        model?: string;
        manufacturer?: string;
        brand?: string;
        android_sdk?: string;
        android_release?: string;
        hardware?: string;
        product?: string;
        ios_system_name?: string;
        // §3.3 ✱ — native only. "Does this crash only on cheap devices?"
        cpu_abi?: string;
        low_ram?: boolean;
        // §3.3 ✱ — both builds, never null: CLS and LCP scale with the viewport, and
        // `orientation` splits CLS, dwell and interactions. Read at log time, like
        // `network.*`, because a device rotates mid-session (§3.1).
        screen_density?: number;
        screen_width_px?: number;
        screen_height_px?: number;
        orientation?: Orientation;
    };
}

export interface UserProfile {
    userId?: string;
    /** @deprecated Removed in v5 — use `identify({ name })`. Still the source of `user.name`. */
    fullName?: string;
    /** @deprecated Removed in v5 — never reached the wire; `identify()` could not set it. */
    firstName?: string;
    /** @deprecated Removed in v5 — never reached the wire; `identify()` could not set it. */
    lastName?: string;
    email?: string;
    phone?: string;
    /** @deprecated Removed in v5 — no column and no reader; `user.avatar` is off the wire (§3.4). */
    avatar?: string;
    customAttributes?: Record<string, any>;
    /** @deprecated Removed in v5 — in-memory only, so it meant "first identify() this process" (§3.4). */
    createdAt?: number;
    /** @deprecated Removed in v5 — byte-identical to `createdAt` for any one-identify() app (§3.4). */
    updatedAt?: number;
}


type Opts = {
    sender?: Sender;
    batchSize?: number;
    flushIntervalMs?: number;
    endpoint?: string;
    sessionId?: string;
    userId?: string;
    sdkVersion?: string;
    platform?: string;          // device OS (ios|android|web); forms the device/session id suffix
    // What `app.start` reports as `span.start_time` (§6.2). Web passes
    // `performance.timeOrigin`; native leaves it defaulted to `initialize()`. Neither is a
    // fork time, and the two are not comparable — see TraceManager.
    traceLaunchStart?: number;
    deviceInfoHandler?: DeviceInfoHandler;
    networkInfoHandler?: NetworkInfoHandler;
    store?: Store;              // persisted state port (#89); defaulted per build by the entry
    // Constructor-only (§3.6). A runtime setter leaves a window between init and
    // registration where session.started, the launch root and the early http.requests
    // all land — that window is the reason, and it is not negotiable.
    beforeSend?: BeforeSend;
    sessionSampleRate?: number; // 0.0-1.0, sticky per session; default 1 (send everything)
    // §6.4, #99. Bare hosts, exact match, ports ignored, **empty by default** — v4 is dark
    // on upgrade, so nobody's CORS breaks until they opt in. Listing a host is the
    // consumer's assertion that that host's CORS config allows the `traceparent` header.
    traceHostAllowlist?: string[];
    // §4.8's symbolication resolve key, third part of `(app_id, device.platform, app.build_id)`.
    // Consumer-supplied — the SDK has zero OTA awareness and cannot derive one — omitted when
    // unset, and **never** falls back to version + build_number: under Expo Updates or
    // CodePush the binary is unchanged, so that fallback resolves against the wrong map and
    // produces frames that are plausible and wrong, with nothing on the row marking them.
    buildId?: string;
    // The deprecated native screen feeds — `navigation` and `screen.duration` (§4.11) — on
    // the ROUTE path. Defaults on, because shared core's v3 behaviour *is* the native one;
    // the web entry opts out, having never emitted `screen.duration` at all. It does not
    // silence web's own history path, which still emits `navigation`. Config from the entry,
    // which is the platform split point — not a branch inside shared code.
    deprecatedScreenFeeds?: boolean;
};

/**
 * A bad rate must not silently mute a deployment: `Math.random() < NaN` is always false,
 * so an unvalidated `undefined`-shaped value would sample every session out and look
 * exactly like a dead collector. Out of range means "the consumer meant something", and
 * the only safe reading of that is 1.
 */
function normalizeSampleRate(rate: number | undefined): number {
    if (rate === undefined) return 1;
    // Number.isFinite is false for a non-number too, so this covers a JS caller's "0.5".
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
        debug.warn(`Telemetry: sessionSampleRate must be a number in [0,1] — got ${rate}; using 1`);
        return 1;
    }
    return rate;
}

/**
 * Telemetry core: queueing, batching, retries, auto-replay and session/user management.
 * Keeps the external API you already use: log(name, data?), flush(), shutdown().
 */
export class Telemetry {
    private queue: TelemetryEvent[] = [];
    private sender?: Sender;
    private batchSize: number;
    private flushIntervalMs: number;
    private intervalId: any = null;
    private endpoint?: string;
    private crashHandler?: CrashHandler;
    private navigationTracker?: NavigationTracker;
    // single screen-tracking API (timed); used by the native screenStart/screenEnd
    public screens: ScreenTimingTracker;
    // The View entity (§4.5, #96): view.id/view.name on every row, the `view` event at each
    // of the four exit boundaries, and the name ladder. Public because the route, lifecycle
    // and interaction adapters all feed it.
    public readonly views: ViewManager;
    // Trace and span core (§6, #98): the live-root carrier, the three roots this ticket
    // mints and the tier key builders. Public for the same reason `views` is — the
    // interceptors, the lifecycle adapter and ViewManager all read it, synchronously.
    public readonly trace: TraceManager;
    // The web click tracker, parked here so `trackInteractions()` is idempotent: a second
    // call must reuse this tracker rather than add a second capture-phase listener (#102).
    // Untyped and unset on native, whose producer is the public `trackTap(name)` (#103) and
    // needs no tracker here — its only state is a rage window, held by TelemetryNative.
    public webInteractions?: { start(): void };
    // The web vitals tracker, parked here for the same reason (§5.3, #106): `trackWebVitals()`
    // must reuse it, or a second call double-subscribes and doubles every vital row. Unset on
    // native, which emits no vitals ever.
    public webVitals?: { start(): Promise<void> };
    private readonly deprecatedScreenFeeds: boolean;
    // last-known screen; best-effort context for the deprecated screen feeds (#33)
    public currentScreen?: string;

    private networkInfoHandler: NetworkInfoHandler;
    private deviceInfoHandler: DeviceInfoHandler;

    // Persisted state (#89). The entry injects webStore()/nativeStore(); shared core
    // never imports either. Both entries always inject, so the fallback below only
    // covers a direct `new Telemetry()` — it reports `unavailable`, putting such a
    // caller on the same branch as incognito rather than crashing.
    // Public because it is this seam's only observation point until v4's device.id,
    // session resume, sticky sample rate and capped offline store read it.
    public readonly store: Store;

    private frameDropsHandler?: FrameDropsHandler;
    private networkHandler?: NetworkHandler;
    private memoryHandler?: MemoryHandler;
    private navigationHandler?: NavigationHandler;


    // session / user state
    // Consumer-owned (#91). No anonymous mint: absent until the host app supplies one,
    // so COUNT(DISTINCT user.id) is known-user reach and not a visitor count.
    private userId?: string = undefined;
    // SDK-owned, persisted, uninstall-scoped, never rotates — not on login, not on logout.
    private deviceIdEphemeral = false;
    private deviceIdPromise?: Promise<string>;
    private userProfile?: UserProfile = undefined;
    private sessionId: string;
    private sessionStart: number;
    private sdkVersion: string;
    private platform?: string;
    private eventCount = 0;
    // last-20 action trail, attached to app.crash as error.breadcrumbs (#28, §4.7)
    private breadcrumbs = new BreadcrumbBuffer(20);
    // session lifecycle (#29)
    private lastActivity?: number;       // last non-session event time; drives 30-min idle rotation
    private sessionSequence = 0;         // increments per acknowledged (2xx) batch
    private eventSequence = 0;           // event.sequence — per-session ordinal, stamped at enqueue
    private sessionEventCount = 0;       // events this session (journey summary)
    private errorCount = 0;              // app.crash + app.error this session (sdk.error_count)

    // Sampling and scrubbing (#93, §3.6). `configuredSampleRate` is what the constructor
    // was given and what every rotation re-rolls at; `sampleRate` is what *this* session
    // was rolled at and what ships as session.sample_rate, so a consumer retuning
    // mid-quarter can't retroactively mis-scale a session already in flight.
    private readonly configuredSampleRate: number;
    private sampleRate: number;
    private sampled: boolean;
    private readonly beforeSend?: BeforeSend;
    /** `app.build_id` (§4.8). Empty string is *not* a build id — it is an unset one. */
    private readonly buildId?: string;
    private hookDropped = 0;             // sdk.hook_dropped — the hook working
    private hookFailed = 0;              // sdk.hook_failed  — the hook broken

    // Drop accounting (§3.7). Process-lifetime and monotonic — deliberately not reset by a
    // rotation, so "how much did this install lose" is one subtraction and not a sum.
    // These are lossy about their own loss by construction: they only arrive if a *later*
    // event gets through, so the tab that closes and never returns reports nothing.
    // `event.sequence`'s gaps are what actually covers that.
    private eventsDropped = 0;
    private dropReason?: DropReason;
    // Highest `event.sequence` the crash path has already written to the offline store, so a
    // second crash persists only the rows the first one did not. -1 means "nothing yet".
    private crashPersistedThrough = -1;
    // `app.start` is once per *process* (§6.2), and web re-enters resumeOrStartSession() on a
    // bfcache restore — which resumes a process rather than starting one.
    private appStartEmitted = false;

    constructor(opts?: Opts) {
        this.sender = opts?.sender;
        // Android's numbers, deliberately (§9.4). These SDKs feed shared tables, so a
        // per-SDK cadence makes cross-platform arrival comparisons quietly wrong. POSTs get
        // ~25x larger and 3x rarer; the collector clears a 50-event batch ~20x over (§2.3).
        this.batchSize = opts?.batchSize ?? 50;
        this.flushIntervalMs = opts?.flushIntervalMs ?? 30000;
        this.endpoint = opts?.endpoint;
        this.platform = opts?.platform;   // set before id generation (suffix source)
        this.store = opts?.store ?? memoryStore({ unavailable: true });
        this.beforeSend = opts?.beforeSend;
        // "Omitted when unset, never `\"\"`" (§4.8): an empty-string build id would reproduce
        // §9.3's `rum_apps` collapse inside symbolication, where absence is itself the signal.
        this.buildId = typeof opts?.buildId === "string" && opts.buildId !== "" ? opts.buildId : undefined;
        this.configuredSampleRate = normalizeSampleRate(opts?.sessionSampleRate);
        this.sampleRate = this.configuredSampleRate;
        // Rolled here so a bare `new Telemetry()` — no resumeOrStartSession() — is decided
        // too. hydrateSession() overwrites it when a durable record says otherwise.
        this.sampled = this.rollSample();

        // start a session
        this.sessionId = opts?.sessionId ?? this.generateSessionId();
        if (opts?.userId) this.setUserId(opts.userId);
        this.sessionStart = Date.now();
        this.sdkVersion = opts?.sdkVersion ?? SDK_VERSION;

        // auto replay if supported
        if (this.sender?.replayFailed) {
            // don't block constructor; best-effort
            this.sender.replayFailed().catch((err: any) => {
                debug.warn("Telemetry replay failed Telemetry class:", err);
            });
        }

        if (this.flushIntervalMs > 0) {
            this.intervalId = setInterval(() => this.flush().catch(() => { }), this.flushIntervalMs);
        }

        this.navigationTracker = new NavigationTracker(this);
        this.screens = new ScreenTimingTracker(this);
        this.deprecatedScreenFeeds = opts?.deprecatedScreenFeeds ?? true;
        // Before the ViewManager, not after: the launch root is minted in this constructor so
        // the initial view can parent to it. A view that minted its own root instead would
        // make a web hard load report `trace.root_type = navigation` (§6.2).
        this.trace = new TraceManager(opts?.traceLaunchStart, opts?.traceHostAllowlist);
        // The initial view opens here, at SDK init — so no row can ever precede a view (§4.5).
        this.views = new ViewManager(this);

        this.deviceInfoHandler = opts?.deviceInfoHandler ?? {
            start: async () => Promise.resolve(),
            collect: async () => Promise.resolve({
                app: { name: '', version: '' },
                device: { platform: '' }
            })
        };
        this.networkInfoHandler = opts?.networkInfoHandler ?? {
            start: async () => Promise.resolve({}),
            collect: async () => Promise.resolve({})
        };

    }

    // ---------- Session & User APIs ----------

    /**
     * §4.7 — report a handled error. Accepts `unknown` on purpose: half of real `catch`
     * blocks receive a string or an axios rejection object, and a consumer should not have
     * to prove to TypeScript that it is an `Error` before reporting it.
     *
     * Emits `app.error`, **never** `app.crash`. There is deliberately no public path to
     * `app.crash` — a consumer's own code must not be able to manufacture rows in the one
     * table an unfiltered crash-free rate is read from.
     *
     * `source` is SDK-internal (`captureConsole` passes `"console"`); the public wrappers
     * forward two arguments, so a consumer can only ever produce `"reported"`. Routing the
     * console path through here rather than through `log()` directly is what keeps the
     * `error.fatal` rule in one place.
     */
    public captureError(error: unknown, context?: Record<string, any>, source: ErrorSource = "reported") {
        // `error.fatal` is native-only (§4.7): on web nothing is fatal, so the key is omitted
        // rather than shipped as a permanent `false` that scores web at a perfect crash-free
        // rate forever. Nothing *reported* is fatal, so on native it is always `false`. The
        // platform opt is the same one that suffixes the ids — the entry's declaration, not a
        // branch on a runtime global.
        const fatal = this.isNativePlatform() ? { fatal: false } : {};
        // Context first: the SDK's own `error.*` keys win a collision.
        return this.log("app.error", { ...context, ...buildErrorAttributes(source, error, fatal) });
    }

    /**
     * Extend the breadcrumb trail without emitting anything. §4.7 demotes `console.warn` to
     * exactly this — React's dev-mode warnings were the bulk of v3's `app.crash` volume.
     *
     * SDK-internal: `public` only so `adapters/crashCapture.ts` can reach it. Not on
     * `TelemetryBase` and not part of the consumer API — a host app that wants a trail entry
     * should `log()` an event, which extends the trail anyway.
     */
    public addBreadcrumb(name: string, data?: Record<string, any>) {
        // `name` and `timestamp` last: a caller's `data` annotates the crumb, it does not
        // rename it out from under the trail.
        this.breadcrumbs.add({ ...data, name, timestamp: new Date().toISOString() });
    }

    public trackErrors(crashHandler: CrashHandler, options?: CrashHandlerOptions) {
        this.crashHandler = crashHandler;
        void crashHandler.attach(options).catch((err) => {
            debug.warn("Telemetry crashHandler attach failed:", err);
        });
    }

    getDeviceInfo(deviceInfoHandler: DeviceInfoHandler) {
        this.deviceInfoHandler = deviceInfoHandler;
        void deviceInfoHandler.start(this).catch((err) => {
            debug.warn("Telemetry deviceInfo tracking start failed:", err);
        });
    }

    getNetworkInfo(networkInfoHandler: NetworkInfoHandler) {
        this.networkInfoHandler = networkInfoHandler;
        void networkInfoHandler.start(this).catch((err) => {
            debug.warn("Telemetry networkInfoHandler start failed:", err);
        });
    }

    public trackFrameDrops(frameDropsHandler: FrameDropsHandler) {
        this.frameDropsHandler = frameDropsHandler;
        void frameDropsHandler.start().catch((err) => {
            debug.warn("Telemetry frameDropsHandler start failed:", err);
        });
    }

    public trackNetworkRequests(networkHandler: NetworkHandler) {
        this.networkHandler = networkHandler;
        void networkHandler.start().catch((err) => {
            debug.warn("Telemetry networkHandler start failed:", err);
        });
    }

    public trackMemoryUsage(memoryHandler: MemoryHandler) {
        // Re-registration retires the incumbent's timer. `trackMemoryUsage()` is auto-started
        // in the native constructor *and* public, so a consumer calling it hands core a second
        // tracker — without this, two 30-second loops and double the sample volume.
        this.memoryHandler?.stop?.();
        this.memoryHandler = memoryHandler;
        void memoryHandler.start().catch((err) => {
            debug.warn("Telemetry memoryHandler start failed:", err);
        });
    }

    public autoTrackNavigation(navigationHandler?: NavigationHandler) {
        this.navigationHandler = navigationHandler;
        void navigationHandler?.start().catch((err) => {
            debug.warn("Telemetry navigationHandler start failed:", err);
        });
    }


    /**
     * The per-session sample roll (§3.6). Never per-event: per-event sampling punches
     * holes that desynchronise the per-view counters by a random factor per view.
     *
     * `Math.random()` is deliberate here where `randomHex` refuses it — this decides one
     * boolean that dies with the session, not an id that persists forever, and a biased
     * PRNG costs a fraction of a percent of sample accuracy rather than a permanent
     * identity collision.
     */
    private rollSample(): boolean {
        return Math.random() < this.sampleRate;
    }

    /** §3.3 / §4.7's platform split, from the entry's declared `platform` opt — never a global. */
    private isNativePlatform(): boolean {
        return this.platform === "ios" || this.platform === "android";
    }

    private generateSessionId(): string {
        const base = `session_${Date.now()}_${randomHex(16)}`;
        // §3.3 / §12's item 13 — suffixed on all three platforms in v4; the web build gained
        // `_web` here, so this is now the same rule `device.id` follows. Nothing parses it.
        return this.platform ? `${base}_${this.platform}` : base;
    }

    public setSessionId(id: string) {
        this.sessionId = id;
        this.sessionStart = Date.now();
    }

    public getSessionId(): string {
        return this.sessionId;
    }

    /**
     * Freeze the identity a deferred row must report (§4.6). Read **synchronously at the
     * moment the thing happened**, so a `log()` that lands after a route change or a session
     * rotation still books the click where it occurred.
     */
    public snapshot(at?: number): LogSnapshot {
        return {
            at,
            viewId: this.views.id,
            sessionId: this.sessionId,
            sessionStart: this.sessionStart,
        };
    }

    /** Collector endpoint, so fetch/XHR adapters can skip self-capturing the SDK's own POST. */
    public getEndpoint(): string | undefined {
        return this.endpoint;
    }

    /**
     * Sampling stays **session-level** (§6.5): an unsampled session injects no header at
     * all — not a `flags=00` id. Read by the interceptors, which sit outside `log()`'s own
     * sampled-out early return and so need the decision directly.
     */
    isSampled(): boolean {
        return this.sampled;
    }

    // ---------- Session lifecycle (#29) ----------

    /**
     * The entry's one call at init (§4.2): resume the durable session when the gap is
     * inside the idle window, otherwise close the stale one out and start fresh.
     *
     * Process death, tab close, hard reload and bfcache restore all land here, and all
     * four **resume** — which is why a resumed session must not re-emit `session.started`
     * (§4.1), or `COUNT(session.started)` stops equalling session count.
     */
    public async resumeOrStartSession() {
        await this.hydrateAndAnnounce();
        // Once per process and on every path — a resume emits no `session.started` at all
        // (§4.1), so `session.reason: "launch"` undercounts launches and `app.start` is the
        // compensator (§4.3). It is also the launch root's own row (§6.2).
        await this.emitAppStart();
    }

    private async hydrateAndAnnounce() {
        const decision = await this.hydrateSession();
        if (decision.kind === "resumed") return;
        // Expired: hydration adopted the old id/start so the finalize ships under them.
        if (decision.kind === "expired") { await this.rotateSession(decision.reason); return; }

        // Storage told us nothing. At init that means launch. On a bfcache restore this method
        // runs a second time with a session already going — storage having nothing to say is no
        // reason to discard it and re-announce a session that never ended. Just re-check the
        // boundaries, which is the whole point of re-running after a long freeze.
        if (this.lastActivity === undefined) { await this.startSession("launch"); return; }
        const reason = this.expiryReason(Date.now());
        if (reason) await this.rotateSession(reason);
    }

    /**
     * `app.start` (§4.3/§6.2): once per process, a **root** of `trace.root_type = launch`,
     * carrying the launch root minted in the constructor. Idempotent because the web build
     * re-runs `resumeOrStartSession()` on a bfcache restore, which is a resumed process and
     * not a new one.
     */
    private async emitAppStart() {
        if (this.appStartEmitted) return;
        this.appStartEmitted = true;
        await this.log("app.start", this.trace.launchRootAttributes());
    }

    /**
     * Read the durable record and adopt it. Adoption happens even when the session has
     * expired: `session.finalized` has to ship under the *old* `session.id` and
     * `session.start_time` before the fresh one takes over.
     */
    private async hydrateSession(): Promise<SessionHydration> {
        const read = await this.store.get(SESSION_KEY);
        // `unavailable` is not `miss` — incognito, a partitioned iframe, ITP eviction or a full
        // disk means this process can never resume and can never be resumed FROM, so every
        // launch mints a session and COUNT(session.started) over-counts. There is no
        // `session.id_ephemeral` on the contract to say so, and inventing one needs backend
        // sign-off — but the same store failed the device.id round-trip, so every event from
        // this population already carries `device.id_ephemeral: true`. Filter on that.
        if (read.status === "unavailable") {
            debug.warn("Telemetry: session storage unavailable — this session cannot be resumed");
            return { kind: "nothing" };
        }
        if (read.status === "miss") return { kind: "nothing" };

        let saved: Partial<PersistedSession>;
        try { saved = JSON.parse(read.value); } catch { return { kind: "nothing" }; }
        // A record we can't trust is not a session to resume; mint rather than guess.
        if (typeof saved?.id !== "string"
            || typeof saved.start !== "number"
            || typeof saved.lastActivity !== "number") return { kind: "nothing" };

        this.sessionId = saved.id;
        this.sessionStart = saved.start;
        this.lastActivity = saved.lastActivity;
        this.sessionSequence = saved.sequence ?? 0;
        this.eventSequence = saved.eventSequence ?? 0;
        this.sessionEventCount = saved.eventCount ?? 0;
        this.errorCount = saved.errorCount ?? 0;
        // A resume is not a rotation: the decision and the rate it was rolled at are
        // adopted as-is, so a relaunch can't half-sample a session. A record written
        // before this field existed reads as `undefined` and keeps the fresh roll.
        // The rate is stamped on every row of the resumed session, and on web the record is
        // browser-wide localStorage — so an out-of-range value would ship as a divisor and
        // silently mis-scale every count taken off it. A record we can't trust here loses
        // its decision too, and the fresh constructor roll stands.
        if (typeof saved.sampled === "boolean"
            && Number.isFinite(saved.sampleRate) && saved.sampleRate! >= 0 && saved.sampleRate! <= 1) {
            this.sampled = saved.sampled;
            this.sampleRate = saved.sampleRate!;
        }

        const reason = this.expiryReason(Date.now());
        return reason ? { kind: "expired", reason } : { kind: "resumed" };
    }

    /**
     * Which boundary, if any, the current session has crossed. Idle is checked first:
     * when a long session has also gone quiet, the reason it ended is that the user left.
     *
     * Inert until `lastActivity` is set, so a bare `new Telemetry()` that never started a
     * session never rotates one.
     */
    private expiryReason(now: number): SessionEndReason | undefined {
        if (this.lastActivity === undefined) return undefined;
        // Both boundaries are strict: a session sitting exactly on one has not crossed it.
        if (now - this.lastActivity > SESSION_IDLE_MS) return "idle";
        if (now - this.sessionStart > SESSION_MAX_MS) return "max_duration";
        return undefined;
    }

    /**
     * Write the session through the `Store` so the next process can resume it.
     *
     * ponytail: one write per event. Web's is a synchronous `localStorage` write; native's
     * is an AsyncStorage round-trip — debounce here if it ever shows up in a trace.
     */
    private async persistSession() {
        const record: PersistedSession = {
            id: this.sessionId,
            start: this.sessionStart,
            lastActivity: this.lastActivity ?? this.sessionStart,
            sequence: this.sessionSequence,
            eventSequence: this.eventSequence,
            eventCount: this.sessionEventCount,
            errorCount: this.errorCount,
            sampled: this.sampled,
            sampleRate: this.sampleRate,
        };
        const write = await this.store.set(SESSION_KEY, JSON.stringify(record));
        // Same first-class `unavailable` path as the read: nothing to retry and nothing to
        // throw, but it must not read as a successful write. See hydrateSession().
        if (write.status === "unavailable") debug.log("Telemetry: session not persisted (store unavailable)");
    }

    /** Emit session.started for the current session. */
    public async startSession(reason: SessionReason) {
        this.lastActivity = Date.now();
        await this.persistSession();   // durable before it is announced
        await this.log("session.started", {
            "session.reason": reason,
            // §4.1, count only — never the hosts (#99). Ships on every session so a zero is
            // legible as "nobody opted in" rather than as a stripped header.
            "sdk.trace_allowlist_size": this.trace.allowlistSize(),
        });
    }

    /**
     * Finalize the current session: journey summary + sdk.error_count, then an immediate flush.
     *
     * The backend discards `duration_ms` and `event_count` and derives both (§4.2) — they
     * stay on the wire because the event survives as the carrier for `session.reason` and
     * `sdk.error_count`, neither of which is derivable. Duration is stamped from
     * `lastActivity`, never `now`: a lazily-detected rotation must report 2 minutes of use,
     * not the 6 idle hours that followed it.
     */
    public async finalizeSession(reason: SessionEndReason) {
        await this.log("session.finalized", {
            "session.duration_ms": Math.max(0, (this.lastActivity ?? this.sessionStart) - this.sessionStart),
            "session.event_count": this.sessionEventCount,
            "sdk.error_count": this.errorCount,
            "session.reason": reason,
        });
        await this.flush();
    }

    /** Begin a fresh session: new id/start, reset per-session counters, emit session.started. */
    public async newSession(reason: SessionReason) {
        this.sessionId = this.generateSessionId();
        this.sessionStart = Date.now();
        this.sessionSequence = 0;
        this.eventSequence = 0;   // the ordinal is per session, and this is a new one
        this.crashPersistedThrough = -1;   // the watermark is an event.sequence, so it resets with it
        this.sessionEventCount = 0;
        this.errorCount = 0;
        // Re-rolled at the *configured* rate, not the retired session's — the previous
        // session may have been resumed from a record written under an older config.
        this.sampleRate = this.configuredSampleRate;
        this.sampled = this.rollSample();
        // `trace.id` never spans a `session.id` (§6.6, invariant 2) — dropped before the
        // successor view mints, so that view starts a fresh `navigation` root rather than
        // extending an action from the retired session.
        //
        // Before `app.start` has shipped, dropping is not enough: it reports the launch root
        // at any age, so its root row would land in the new session while the initial `view`
        // it fathered landed in the old one. That is the expired-record cold launch — §4.3's
        // most common path — so the launch root is re-minted instead of merely cleared.
        if (this.appStartEmitted) this.trace.clear();
        else this.trace.restartLaunchRoot();
        // After the new session.id is in place and before the first row of it is emitted:
        // `view.id` never spans a `session.id` (§4.5). rotateSession() has already emitted
        // the departing view's `view` event under the *old* id.
        await this.views.beginView("session_rotation");
        await this.startSession(reason);
    }

    /** Boundary rotation: finalize the old session then start a fresh one (the pair). */
    public async rotateSession(reason: SessionEndReason) {
        // The session-rotation view boundary (§4.5), emitted first so the `view` row lands
        // under the session it belongs to. newSession() mints the successor.
        await this.views.endView();
        await this.finalizeSession(reason);
        await this.newSession(reason);
    }

    /** Truncated at source (§3.2): the collector caps at 255 and we must not be the one over. */
    public setUserId(id: string) {
        this.userId = id ? id.slice(0, USER_ID_MAX) : undefined;
    }

    public getUserId(): string | undefined {
        return this.userId;
    }

    /**
     * The SDK-owned `device.id` (§3.2/§3.3): self-minted, written through the `Store`,
     * uninstall-scoped, stable across process restarts, and never rotated by login,
     * logout or a profile clear.
     *
     * The platform suffix is the entry's (ios|android|web), not the device-info adapter's:
     * this id is persisted forever, so it must not depend on a call that can throw on first run.
     *
     * `getUniqueId()` is deliberately not used — it already carries two lifetimes on RN
     * alone (ANDROID_ID survives reinstall, identifierForVendor does not), so one identity
     * column would mean two things.
     *
     * When the Store reports `unavailable` — incognito, a partitioned iframe, ITP
     * eviction, a full disk — the id lives for one process only and `device.id_ephemeral`
     * rides the Context block to say so, because that population is otherwise
     * indistinguishable from real installs and reads as traffic growth.
     */
    private async getDeviceId(): Promise<string> {
        this.deviceIdPromise ??= (async () => {
            const read = await this.store.get(DEVICE_ID_KEY);
            if (read.status === "hit") return read.value;
            const suffix = this.platform ? `_${this.platform}` : "";
            const id = `device_${Date.now()}_${randomHex(16)}${suffix}`;
            const write = await this.store.set(DEVICE_ID_KEY, id);
            // Either end of the round-trip failing means this id never comes back.
            this.deviceIdEphemeral = read.status === "unavailable" || write.status === "unavailable";
            return id;
        })();
        return this.deviceIdPromise;
    }

    // ---------- User Profile Management ----------

    /**
     * Set complete user profile information
     */
    public setUserProfile(profile: Partial<UserProfile>): void {
        const now = Date.now();
        
        // If this is a new profile or userId changed, set createdAt
        const isNewProfile = !this.userProfile || (profile.userId && profile.userId !== this.userProfile.userId);
        
        this.userProfile = {
            ...this.userProfile,
            ...profile,
            updatedAt: now,
            ...(isNewProfile && { createdAt: now })
        };

        // Update userId if provided in profile (truncated at source, §3.2)
        if (profile.userId) {
            this.setUserId(profile.userId);
            this.userProfile.userId = this.userId;
        } else if (this.userProfile && !this.userProfile.userId) {
            // Mirror the current id into the profile — undefined while still anonymous
            this.userProfile.userId = this.userId;
        }

        debug.log("Telemetry: User profile updated", this.userProfile);
    }

    /**
     * EdgeRum-style identify(): record the host-app profile and emit the one event that
     * carries it — `user.profile.update` (§4.10, #107). The PII is no longer on the
     * Context block of every event.
     *
     * `userId` is optional and new in v4: the one call that sends a profile should also
     * set the key that profile attaches to, since `user.id` is consumer-supplied (§3.2)
     * and an unkeyed profile has nothing to upsert on. Omitting it leaves `user.id`
     * exactly as it was — identify never mints one.
     */
    public async identify(profile: {
        userId?: string;
        name?: string;
        email?: string;
        phone?: string;
        avatar?: string;
        customAttributes?: Record<string, any>;
    }) {
        if (profile.userId !== undefined) this.setUserId(profile.userId);
        // Only what this call actually supplied — `setUserProfile` merges by spread, so
        // passing `email: undefined` would wipe an email a prior setUserContact() set.
        this.setUserProfile({
            ...(profile.name !== undefined ? { fullName: profile.name } : {}),
            ...(profile.email !== undefined ? { email: profile.email } : {}),
            ...(profile.phone !== undefined ? { phone: profile.phone } : {}),
            ...(profile.avatar !== undefined ? { avatar: profile.avatar } : {}),
            ...(profile.customAttributes !== undefined ? { customAttributes: profile.customAttributes } : {}),
        });
        // Built from the live profile, not from this call's arguments, so a preceding
        // setUserContact()/setUserName() ships too.
        await this.log("user.profile.update", buildProfileAttributes(this.userProfile));
    }

    /**
     * Set user details with individual parameters
     */
    public setUserDetails(details: {
        fullName?: string;
        firstName?: string;
        lastName?: string;
        email?: string;
        phone?: string;
        avatar?: string;
        customAttributes?: Record<string, any>;
    }): void {
        this.setUserProfile(details);
    }

    /**
     * Update specific user profile fields
     */
    public updateUserProfile(updates: Partial<UserProfile>): void {
        if (!this.userProfile) {
            // If no profile exists, create one
            this.setUserProfile(updates);
            return;
        }

        this.userProfile = {
            ...this.userProfile,
            ...updates,
            updatedAt: Date.now()
        };

        debug.log("Telemetry: User profile updated", this.userProfile);
    }

    /**
     * Get current user profile
     */
    public getUserProfile(): UserProfile | undefined {
        return this.userProfile;
    }

    /**
     * Clear user profile data
     */
    public clearUserProfile(): void {
        this.userProfile = undefined;
        this.userId = undefined;   // consumer-owned (§3.2): cleared here, unlike device.id
        debug.log("Telemetry: User profile cleared");
    }

    /**
     * Set user name (convenience method)
     */
    public setUserName(fullName: string, firstName?: string, lastName?: string): void {
        this.setUserProfile({
            fullName,
            firstName,
            lastName
        });
    }

    /**
     * Set user contact info (convenience method)
     */
    public setUserContact(email?: string, phone?: string): void {
        this.setUserProfile({
            email,
            phone
        });
    }

    // ---------- Logging APIs ----------

    /**
     * Log a named event. Keeps existing signature compatibility.
     * Automatically attaches userId and sessionId to every queued event.
     */
    async log(name: string, data?: Record<string, any>, snapshot?: LogSnapshot) {
        this.eventCount++;
        let activity = false;
        let crashed = false;

        // Session activity and the two boundaries — 30-min idle and the 4-hour cap (§4.2).
        // Session events don't count as activity (they're emitted *by* the lifecycle), so
        // they never re-trigger a rotation.
        // `view` joins the session events here: it is emitted *by* a boundary, from inside
        // rotateSession() among others, so letting it re-enter the expiry check would recurse
        // forever on an already-expired session. It is bookkeeping, not user activity.
        if (!name.startsWith('session.') && name !== 'view') {
            const now = Date.now();
            const reason = this.expiryReason(now);
            if (reason) await this.rotateSession(reason);
            this.lastActivity = now;
            this.sessionEventCount++;
            if (isErrorName(name)) this.errorCount++;
            activity = true;
        }

        // A sampled-out session sends nothing at all — not a skeleton record, and
        // crashes are no exception (§3.6): 100% of crashes over 10% of sessions makes
        // the unfiltered crash-free query read 10x too high with no WHERE to repair it.
        // The boundary bookkeeping above still runs, so the rotation that re-rolls the
        // decision still happens on schedule.
        if (this.sampled) {
            // v3 allowlist: unknown names ship as custom_event, original kept as event.name
            const isAllowed = ALLOWED_NAMES.has(name);
            const eventName = isAllowed ? name : 'custom_event';

            const attributes = await this.collectContext(data);
            if (!isAllowed) attributes['event.name'] = name;

            // §6.3's Tier 2. Tier 1's keys were captured earlier — at launch, at view entry,
            // at request send — and arrived through `data`; Tier 3 gets nothing at all.
            // Assigned after `collectContext`, so a caller's `data` cannot forge them.
            if (TIER_2_NAMES.has(eventName)) Object.assign(attributes, this.trace.annotate());

            // `app.crash` carries the trail of prior actions; other events extend the trail.
            // ⚠ Breadcrumbs ride `app.crash` **only** (§4.7): `app.error` volume is
            // consumer-controlled, and a 1-2 KB blob on a high-volume event is how the
            // transport budget gets spent by the SDK's own doing. Stringified, because
            // `stringAttr` renders a real array through `fmt.Sprint` as Go map syntax.
            if (eventName === 'app.crash') {
                attributes['error.breadcrumbs'] = this.breadcrumbs.toJSON();
                crashed = true;
            } else {
                this.breadcrumbs.add({ name: eventName, timestamp: new Date().toISOString() });
            }

            // Two of §4.5's three counters, booked against the view this row is pinned to.
            // `view.error_count` is a closed enumeration — crashes only, not failed requests
            // and not console.warn — but `app.error` counts too (§4.5). `view.request_count`
            // is NOT booked here: §4.5.2 counts
            // requests *started* in the view, and this row is emitted at completion, which
            // can be a route change later. The interceptors book it at send time instead.
            if (isErrorName(eventName)) this.views.countError();
            else if (eventName === 'ui.interaction') this.views.countAction();

            // §3.1's attribution freeze, and §4.6's mint/emit split — one mechanism. A
            // span-carrying row reports the identity live at **span start**, not at emit:
            // §4.2's 4-hour cap can rotate a session while a request is in flight, and a tap
            // that navigates would otherwise be booked against the view it opened, silently
            // inverting every "which screen frustrates users" query. Applied after
            // `collectContext`, with the identity keys, so it is the SDK's snapshot and never
            // a caller's `data`. Point events pass none and are unaffected.
            if (snapshot) {
                attributes['view.id'] = snapshot.viewId;
                // Resolved at log time by lookup on the *frozen* id (§3.1), never replayed
                // from the snapshot: a rung upgrade between mint and emit renames the view
                // in place, and a row must never carry a name that disagrees with its own id.
                attributes['view.name'] = this.views.nameOf(snapshot.viewId);
                attributes['session.id'] = snapshot.sessionId;
                attributes['session.start_time'] = new Date(snapshot.sessionStart).toISOString();
            }

            this.enqueue({
                type: 'event',
                eventName,
                timestamp: new Date(snapshot?.at ?? Date.now()).toISOString(),
                attributes,
            });

            debug.log("Telemetry queued event:", name, "Queue size:", this.queue.length);
            debug.log("Event attributes:", attributes);
        }

        // After the enqueue, never before it: the durable record is for the *next* process,
        // and on native this is an AsyncStorage round-trip that must not sit in front of the
        // event it describes.
        if (activity) await this.persistSession();

        // A crash is the row the process may not survive to send twice, so it does not wait
        // for the batch to fill. Awaited, unlike the batch-full flush: `app.crash` is emitted
        // from a dying process's teardown, and a fire-and-forget send there is a send that
        // never happens.
        if (crashed) {
            await this.flushCrash();
        } else if (this.queue.length >= this.batchSize) {
            void this.flush();
        }
    }

    /**
     * The crash path (§2 / §9.4): persist the whole queue, then send **one** batch reordered
     * so the crash rides in it. Not a drain — a dying process gets one round trip.
     *
     * ⚠ The web/native asymmetry is real and is not fixed here. On web the `Store` is
     * synchronous `localStorage`, so the persist has *landed* by the time the next line runs
     * and the loss window closes. On native it is an AsyncStorage round-trip that a SIGKILL
     * can outrun, so the window only narrows. Awaiting harder does not change that; the
     * asymmetry is the `Store` port's whole point (`core/store.ts`).
     *
     * The persisted copy is a safety copy, not a handoff: the queue is left intact, because
     * an `app.crash` is not always fatal — `window.onerror` fires and the page keeps running
     * — and the process usually lives on. A successful send therefore
     * leaves a duplicate on disk to replay next launch — which is what `event.sequence` and
     * the backend's `(session_id, event_sequence)` dedup exist for (§2.4).
     *
     * *One* duplicate. Each row is written at most once by this path, watermarked on
     * `event.sequence`: a chatty app crash-flushes often, and re-persisting the whole queue
     * each time would fill the store with copies of
     * its own backlog and book `store_full` drops that are not loss — corrupting the very
     * counter this change adds.
     */
    private async flushCrash() {
        if (!this.sender || this.queue.length === 0) return;

        // Move crashes to the front, relative order intact: at batchSize 50 a crash enqueued
        // behind 49 older events would otherwise miss the only batch this process gets.
        const isCrash = (e: TelemetryEvent) => e.eventName === 'app.crash';
        this.queue = [...this.queue.filter(isCrash), ...this.queue.filter(e => !isCrash(e))];

        const pending = this.queue.filter(e => seqOf(e) > this.crashPersistedThrough);
        if (pending.length > 0 && this.sender.onFailure) {
            try {
                this.recordDrop("store_full", await this.sender.onFailure(pending));
                // Advanced only on a write that returned: a throw leaves the watermark where
                // it was, so the next crash retries these rows rather than abandoning them.
                this.crashPersistedThrough = Math.max(this.crashPersistedThrough, ...pending.map(seqOf));
            } catch (err) {
                debug.warn("Telemetry: crash-path persist failed:", err);
            }
        }

        // Spliced *before* the send, not after: both the interval and the batch-full trigger
        // fire flush() unawaited, so a concurrent flush() splices this same front — and a
        // post-send splice would then delete rows this batch never carried, silently and
        // without booking them. Sent directly rather than through flush() because the rows
        // are already on disk and flush()'s failure path would persist them a second time.
        const batch = this.queue.splice(0, this.batchSize);
        try {
            await this.sender.send(batch);
            await this.ackBatch();
        } catch (err) {
            // Requeue only what the store does not already hold — the rest is safe on disk
            // and requeueing it would send it twice for no gain.
            const unsaved = batch.filter(e => seqOf(e) > this.crashPersistedThrough);
            if (unsaved.length > 0) this.queue.unshift(...unsaved);
            debug.warn("Telemetry: crash-path send failed:", err);
        }
    }

    /**
     * Build the v3 Context block that rides on every event AND metric: the flattened
     * device/network snapshot, the caller's data, identity + session + sdk fields, and the
     * user profile. Shared by log() and logMetric() so both carry the identical iOS-clean set.
     */
    private async collectContext(data?: Record<string, any>): Promise<Record<string, any>> {
        let deviceInfo: Record<string, any> = {};
        let networkInfo: Record<string, any> = {};

        try {
            deviceInfo = (await this.deviceInfoHandler?.collect()) || {};
        } catch (err) {
            debug.warn("Telemetry: failed to fetch device info", err);
        }

        try {
            networkInfo = (await this.networkInfoHandler?.collect()) || {};
        } catch (err) {
            debug.warn("Telemetry: failed to fetch network info", err);
        }

        // Mint/read before assembling. device.id is persisted forever, so its suffix comes
        // from the entry-supplied platform and never from collect(), which can throw.
        const deviceId = await this.getDeviceId();

        const attributes: Record<string, any> = {
            // deviceInfo already namespaces its own keys (app.*, device.*) — flatten flat
            ...this.flattenWithPrefix('', deviceInfo),
            ...this.flattenWithPrefix('network', networkInfo),
            ...this.flattenWithPrefix('', data || {}),
            // Identity keys land after caller data: `data` may override app./device./network.*
            // but must never override these (§3.3).
            // With the identity keys, not with deviceInfo's `app.*`: it is the symbolication
            // join key, so a stray `log()` payload must not be able to shift which map a
            // crash resolves against.
            ...(this.buildId ? { 'app.build_id': this.buildId } : {}),
            'device.id': deviceId,
            ...(this.deviceIdEphemeral ? { 'device.id_ephemeral': true } : {}),
            // Omitted entirely on anonymous traffic (§3.2) — no "", no placeholder.
            ...(this.userId ? { 'user.id': this.userId } : {}),
            // Denormalized onto every row (§4.5) so "errors by screen" needs no join. The id
            // is the join key; the name is the view's current best, resolved here at log time
            // by lookup on that id, so a row can never carry a name that disagrees with it.
            'view.id': this.views.id,
            'view.name': this.views.name,
            'session.id': this.sessionId,
            'session.start_time': new Date(this.sessionStart).toISOString(),
            'session.sequence': this.sessionSequence,
            // Extrapolation is arithmetic when the rate is on the row: it survives a
            // consumer retuning mid-quarter, which config-in-a-spreadsheet does not.
            'session.sample_rate': this.sampleRate,
            // Monotonic and always present; the reason stays omitted until there is one,
            // so `sdk.drop_reason IS NOT NULL` is a usable filter for "this install lost data".
            'sdk.events_dropped': this.eventsDropped,
            ...(this.dropReason ? { 'sdk.drop_reason': this.dropReason } : {}),
            'sdk.hook_dropped': this.hookDropped,
            'sdk.hook_failed': this.hookFailed,
            'sdk.platform': sdkPlatform(this.platform),
            'sdk.version': this.sdkVersion,
        };

        // §4.10, #107 — the profile keys are deliberately NOT here; they ride
        // `user.profile.update` alone. `user.id` above is the join key and stays.

        return attributes;
    }

    /**
     * Emit a metric on the v3 `type:"metric"` path: { type, metricName, value, timestamp, attributes }.
     * Carries the same Context block as events. Metrics are samples, not user actions, so they
     * don't extend the breadcrumb trail and don't count as session activity — a periodic sampler
     * (memory/frames) must not keep a session alive and defeat the 30-min idle rotation.
     */
    async logMetric(metricName: string, value: number, data?: Record<string, any>) {
        this.eventCount++;
        // A metric is a sample, not a user action: it must not refresh `lastActivity` and
        // keep a dead session alive. It is still *checked* against the boundaries, or a
        // metric-only stream (a backgrounded app sampling memory) would ship forever under
        // a session that expired hours ago and never hit the 4-hour cap (§4.2).
        const reason = this.expiryReason(Date.now());
        if (reason) await this.rotateSession(reason);

        if (!this.sampled) return;

        const attributes = await this.collectContext(data);
        // §5.1 — assembled after caller `data`, so a stray attribute cannot mislabel the
        // unit of the column it lands in. Omitted for a name we have no unit for.
        const unit = METRIC_UNIT[metricName];
        if (unit) attributes['metric.unit'] = unit;

        this.enqueue({
            type: 'metric',
            metricName,
            value,
            timestamp: new Date().toISOString(),
            attributes,
        });
        if (this.queue.length >= this.batchSize) {
            void this.flush();
        }
    }

    /**
     * The single enqueue point: neither the sample decision nor `beforeSend` can be
     * bypassed by a future emit path, and the hook runs *before* the queue — which is
     * what keeps scrubbed fields off disk when a send fails and the batch is persisted.
     *
     * The sample check is repeated by log()/logMetric() ahead of `collectContext()`, so
     * a sampled-out session does no work per event; this one is the backstop that makes
     * the guarantee structural rather than a convention two call sites happen to follow.
     *
     * The two counters are separate on purpose: "my volume is down 40%" has to
     * distinguish *my rule is too broad* from *my rule is crashing*, and one merged
     * counter answers neither.
     */
    private enqueue(e: TelemetryEvent) {
        if (!this.sampled) return;

        let kept = e;
        if (this.beforeSend) {
            const outcome = applyBeforeSend(e, this.beforeSend);
            if (outcome.kind === "failed") { this.hookFailed++; return; }
            if (outcome.kind === "dropped") { this.hookDropped++; return; }
            kept = outcome.event;
        }

        // After the hook, never before (§2.4): an event the hook drops must not consume an
        // ordinal, or every scrubbed row would read as a gap — and gaps are precisely how
        // the backend tells real loss from a replay. Tier A already protects the key, so a
        // hook cannot forge or delete one once stamped.
        (kept.attributes ??= {})['event.sequence'] = this.eventSequence++;

        this.queue.push(kept);
        this.capQueue();
    }

    /**
     * Hold the in-memory queue at its cap (§9.4), booking what it costs.
     *
     * The count lands on the *next* event's Context block, not this one's — `collectContext()`
     * has already run by the time we get here. That is §3.7's stated behaviour, not a bug.
     */
    private capQueue() {
        while (this.queue.length > QUEUE_MAX_EVENTS) {
            this.queue.splice(evictIndex(this.queue), 1);
            this.recordDrop("queue_full");
        }
    }

    /**
     * Book dropped rows against the monotonic counter and the reason that shipped last.
     * Takes `Sender.onFailure`'s return shape as-is — a sender with no cap returns nothing.
     */
    private recordDrop(reason: DropReason, count: number | void = 1) {
        if (!count || count <= 0) return;
        this.eventsDropped += count;
        this.dropReason = reason;
    }

    private flattenWithPrefix(prefix: string, obj: Record<string, any>, depth = 0): Record<string, any> {
        const result: Record<string, any> = {};

        for (const key in obj) {
            if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;

            const value = obj[key];
            const prefixedKey = prefix ? `${prefix}.${key}` : key;

            // §3.3's null discipline — "absent means the SDK had nothing" (#108). An
            // `undefined` value was already dropped by the sender's `JSON.stringify`, so
            // this is wire-neutral; what it fixes is the in-memory bag, where
            // `device.android_sdk: undefined` on a web row made the 39-key shape
            // unassertable and handed `beforeSend` keys that never ship.
            if (value === undefined) continue;

            // §4.10, #107 — the depth guard. Without it a cyclic value recursed until the
            // stack blew, *inside* the SDK, taking the host app's render tree with it. A
            // bad payload is a dropped key, never a RangeError.
            if (typeof value === 'object' && value !== null && !Array.isArray(value) && depth < FLATTEN_MAX_DEPTH) {
                Object.assign(result, this.flattenWithPrefix(prefixedKey, value, depth + 1));
            } else if (typeof value === 'object' && value !== null) {
                // An array, or an object at the depth cap. Both ride as a JSON string rather
                // than as themselves — the primitive-values rule, and the only way to close
                // the hole a cycle *inside an array* leaves: the array branch never recurses,
                // so the depth guard cannot see it and the throw would land in the sender's
                // `JSON.stringify`, where `flush()` swallows it and the whole batch is lost
                // silently. Stringifying is also what the collector's `fmt.Sprint` would do
                // to a raw array, only in Go map syntax rather than JSON.
                const flat = stringifyOrDrop(value);
                if (flat !== undefined) result[prefixedKey] = flat;
            } else {
                result[prefixedKey] = value;
            }
        }

        return result;
    }



    /**
     * Explicit metric helper (optional convenience) — routes through the v3 metric path.
     */
    recordMetric(name: string, value: number, data?: Record<string, any>) {
        return this.logMetric(name, value, data);
    }

    // ---------- Flush / Persistence ----------

    // Retry + backoff live in the Sender (see sendWithRetry in web/native senders),
    // which is also used by the standalone replay paths. flush() does a single send
    // and, on failure, hands the batch to the sender to persist (or requeues it).
    async flush() {
        if (!this.sender || this.queue.length === 0) return;

        // build a batch of up to batchSize
        const toSend = this.queue.splice(0, this.batchSize);

        try {
            await this.sender.send(toSend);
            await this.ackBatch();
        } catch (lastError) {
            if (this.sender.onFailure) {
                try {
                    this.recordDrop("store_full", await this.sender.onFailure(toSend));
                } catch (persistErr) {
                    // If persistence fails, requeue to avoid data loss
                    this.queue.unshift(...toSend);
                    debug.warn("Sender.onFailure failed, requeued events:", persistErr);
                }
            } else {
                this.queue.unshift(...toSend);
            }

            debug.error("Telemetry flush failed:", lastError);
            throw lastError;
        }
    }

    /**
     * Book an acknowledged (2xx) batch. `session.sequence` orders a session's batches (#29),
     * and it is persisted because a resumed session restarting at 0 would emit duplicate
     * (session.id, session.sequence) pairs and stop ordering anything (#92).
     */
    private async ackBatch() {
        this.sessionSequence++;
        await this.persistSession();
    }

    getQueue() {
        return [...this.queue];
    }

    async shutdown() {
        if (this.intervalId) clearInterval(this.intervalId);
        this.memoryHandler?.stop?.();
        await this.flush();
    }

    // Screen tracking lives in ScreenTimingTracker (this.screens), the single timed API.

    // Expose some internal counters (optional)
    getEventCount() {
        return this.eventCount;
    }

    /**
     * A route change: the view boundary (§4.5) plus, on native only, the two deprecated
     * feeds (§4.11). v3's two native screen paths were disjoint — `attachNavigation` never
     * touched `inst.screens`, so a React Navigation consumer emitted `navigation` on every
     * route change and never a single `screen.duration`. Unifying them here is what fixes
     * that, which is why a *deprecated* event starts firing where it never has.
     */
    async recordRouteChange(from: string, to: string) {
        this.currentScreen = to;   // best-effort screen for the deprecated feeds (#33)
        if (this.deprecatedScreenFeeds) {
            // Both rows describe the transition, so both are emitted — and awaited — before
            // the view boundary: they belong to the view being left.
            await this.navigationTracker?.recordRouteChange(from, to);
            await this.screens.endScreen(from);
            // Arm the dwell clock for the arriving screen. `markStart`, not `startScreen`:
            // the latter emits its own `navigation`, and the line above already emitted this
            // transition's. This is the join that was missing — v3's `attachNavigation` never
            // touched `screens`, so `screen.duration` never fired for a React Navigation app.
            this.screens.markStart(to);
        }
        await this.enterView(to, "route");
    }

    /**
     * Feed the name ladder (§4.5.1). Rungs 1 and 2 arrive unnormalized; rung 3's caller
     * normalizes before calling. Whether this re-stamps the current view or mints a
     * successor is the ladder's decision, not the caller's.
     */
    async enterView(name: string, source: ViewNameSource) {
        await this.views.navigate(name, source);
    }


}

