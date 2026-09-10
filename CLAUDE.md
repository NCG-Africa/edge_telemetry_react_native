# CLAUDE.md — @nathanclaire/edge-telemetry-sdk (React Native) Development Guide

Source of truth for AI-assisted development on this repo. Read it before writing code.

`sdk-audit.yaml` (repo root) is the machine-readable companion: every emitted event, every
common attribute, transport behaviour and known gap, each with a `file:line` citation. When
this doc and the audit disagree, the audit was generated from the code — trust it and fix
this doc.

---

## What this project is

A lightweight Real User Monitoring SDK for **React Native** apps (plus a web build via React
Native Web). It captures performance, errors, network requests, device/network context and
navigation, then ships them to the shared **EdgeTelemetryProcessor** backend — the same
backend the Android (Ionic) and iOS SDKs feed.

- npm: `@nathanclaire/edge-telemetry-sdk`, currently **v3.1.0**. (v2 was the unscoped
  `edge-telemetry-sdk`, now deprecated.)
- Bundler: **Vite** (`vite build` → `dist/`). Not `react-native-builder-bob`.
- Dual entry: web (`dist/index.web.js|.cjs`) and native (`dist/index.native.js|.cjs`),
  selected by the `package.json` `exports` map and the `.web.ts` / `.native.ts` file split.

**v3 is on the EdgeRum wire contract.** Envelope, auth, ISO timestamps, ID formats, the
Context block and the event allowlist all match the sibling SDKs. Do not "improve" any of
that unilaterally — it is a cross-SDK contract.

---

## Architecture

No monorepo. One `src/` tree, split by platform at the file level:

```
src/
├── createTelemetry.web.ts / .native.ts   ← factory + assertApiKey (bundler picks one)
├── index.web.ts / index.native.ts        ← TelemetryWeb / TelemetryNative (public entries)
├── index.base.ts                         ← TelemetryBase: shared delegation for both
├── core/
│   ├── telemetry.ts       ← Telemetry: queue, batch, retry, session lifecycle, log/logMetric
│   ├── breadcrumbs.ts     ← ring buffer (last 20) for crash.breadcrumbs
│   ├── debug.ts           ← debug() gate; all SDK-internal logging goes through this
│   ├── store.ts           ← Store port: get/set/remove over persisted state, no RN import
│   ├── memoryStore.ts     ← in-memory Store, configurable sync or async
│   └── utils/uuid.ts      ← randomHex() — one shared impl, no platform split
├── adapters/
│   ├── batch.ts           ← buildBatch(): the telemetry_batch envelope, shared by both senders
│   ├── failedEvents.ts    ← offline-queue key + decode/encode, shared by both senders
│   ├── appLifecycle.ts    ← AppLifecycleEmitter (edge-triggered foreground/background)
│   ├── crashCapture.ts    ← shared crash normalisation → app.crash
│   ├── httpAttributes.ts  ← shared http.* attribute builder
│   ├── frameAggregate.ts  ← rAF deltas → one frame_render_time metric per 10s window
│   ├── interaction.ts     ← user.interaction tap emitter
│   ├── networkChange.ts   ← edge-triggered network_change emitter
│   ├── navigationTracker.ts / screenTiming.ts
│   ├── webSender.ts / nativeSender.ts
│   ├── web/               ← *.web.ts capture adapters (+ store.web.ts over localStorage)
│   └── native/            ← *.native.ts capture adapters (+ store.native.ts over AsyncStorage)
└── shims/
    ├── react-native-web-shim.ts
    └── modules.d.ts       ← ambient decls for untyped side-effect deps
```

**Two kinds of shared code.** Platform-agnostic *logic* (envelope building, transition
detection, attribute shaping) lives in a plain `adapters/*.ts` and is unit-tested once —
that's how web and native stay in lockstep. Platform *APIs* (AppState, NetInfo, ErrorUtils,
DOM) live only in `*.native.ts` / `*.web.ts`, and the bundler picks the file. Never branch on
platform inside a shared file.

### How a consumer wires it up

```ts
import { createTelemetry } from "@nathanclaire/edge-telemetry-sdk";

const telemetry = createTelemetry({
  apiKey: "edge_...",                 // required; must start with "edge_"
  endpoint: "https://collector.example.com/telemetry",
  batchSize: 20,
  flushIntervalMs: 10000,
});

await telemetry.identify({ name: "Ada", email: "ada@x.io" });
await telemetry.log("checkout_started", { cart_value: 42 });
telemetry.attachNavigation(navigationRef);   // native only, React Navigation ref
```

`createTelemetry()` returns `TelemetryWeb` or `TelemetryNative`. **Every public method is
`async`** — both classes lazily build the core `Telemetry` behind an `instancePromise`.

---

## Public API surface

```ts
type TelemetryOpts = {
  apiKey: string;           // REQUIRED, must start with "edge_" — assertApiKey throws otherwise
  endpoint?: string;        // POST target. Default is a PLACEHOLDER — always pass a real one
  batchSize?: number;       // events per flush. core default 2 (set this — 2 is too low for prod)
  flushIntervalMs?: number; // default 10000; <=0 disables the interval timer
  captureConsole?: boolean; // console.error/warn → app.crash. Default ON
  debug?: boolean;          // SDK-internal diagnostics. Default off
  sender?: Sender;          // override the default platform sender
  store?: Store;            // override the default platform Store (see below)
};
```

Methods (both classes, all return Promises):

```ts
log(event, data?) / flush() / shutdown()
identify({name?, email?, phone?, avatar?, customAttributes?})   // emits user.profile.update
setUserId / setUserProfile / setUserDetails / updateUserProfile
getUserProfile / clearUserProfile / setUserName / setUserContact
trackErrors({captureConsole?}) / getDeviceInfo() / getNetworkInfo()
```

Native-only on `TelemetryNative`: `attachNavigation(ref)`, `trackRoute(from, to)`,
`screenStart(name)`, `screenEnd(name)`, `interactionProps()`.

`trackErrors`, `trackFrameDrops`, `trackNetworkRequests`, `trackMemoryUsage` and
`autoTrackNavigation` are auto-started in the constructor — consumers don't call them.
`interactionProps()` is the exception: the consumer must spread it onto their root `<View>`.

---

## Wire format

```
POST <endpoint>
Content-Type: application/json
X-API-Key: edge_...
Authorization: Bearer edge_...      # same credential, always both — see below

{
  "type": "telemetry_batch",
  "timestamp": "2026-06-14T10:30:00.512Z",   // ISO 8601
  "batch_size": 13,
  "events": [ /* Event | Metric */ ]
}
```

Both credential headers are built by `buildHeaders()` in `adapters/batch.ts` and sent on **every**
POST with the same value: the collector reads `Authorization` under `AUTH_MODE=jwt` and `X-API-Key`
otherwise, so one build serves the shared and the segmented (bank / on-prem) topologies. Never sniff
the credential shape to pick one, and never tighten `assertApiKey` to the collector's ≥3-part API-key
check — that would hard-reject every `edge_<jwt>`. The collector's path is `POST /telemetry`.

Built by `adapters/batch.ts` so both senders are byte-identical. Web uses
`fetch({keepalive:true})` — **not** `sendBeacon`, which cannot set the credential headers.
On failure: retried (3 attempts; native exponential + jitter, web linear), then persisted
**through the `Store` port** under key `telemetry_failed_events` and replayed on next init.
Neither sender touches `localStorage` / `AsyncStorage` directly any more — the decode rules
are shared in `adapters/failedEvents.ts`, and web's persist stays synchronous on purpose.

### Event and Metric

```ts
type TelemetryEvent = {
  type: 'event' | 'metric';
  eventName?: string;     // events
  metricName?: string;    // metrics
  value?: number;         // metrics
  timestamp: string;      // ISO 8601 — never ms epoch
  attributes?: Record<string, any>;
};
```

No top-level `userId`/`sessionId` — identity rides in `attributes` as part of the Context
block.

### The Context block

`collectContext()` merges these into the `attributes` of **every** event and metric. There
are no standalone `device_info` / `network_info` events in v3.

```
session.id, session.start_time (ISO), session.sequence   — all three survive a relaunch (§4.2)
user.id                — only when the consumer supplied one; omitted on anonymous traffic
device.id              — SDK-minted, persisted (+ device.id_ephemeral: true when storage failed)
sdk.platform ("react-native"), sdk.version (package.json version)
app.*        name, version, build_number, package_name
device.*     platform, platform_version, model, manufacturer, brand (+ OS-specific extras)
network.*    type, is_connected
user.*       name/fullName/email/phone/avatar/custom.* — only when a profile is set
```

Caller `data` is flattened dot-notation on top — so it can override any `app.*`, `device.*` or
`network.*` key, but **not** the identity keys, which are assembled after it. Keep attribute
values primitive.

### ID formats

```
session.id : session_{ms}_{16 hex}_{ios|android}   // suffix native only; web omits it
device.id  : device_{ms}_{16 hex}_{ios|android|web}
user.id    : whatever the consumer passes, truncated to 255 — never minted here
```

Entropy is `crypto.getRandomValues` (#91). RN has no WebCrypto, so the native entry
side-effect-imports `react-native-get-random-values` (already a dependency) before the first
id is minted; it is a no-op wherever `crypto` already exists. There is **no `Math.random()`
fallback** — `randomHex` throws with a reinstall instruction instead, because a weak id that
persists forever is worse than refusing to mint one.

The suffix comes from the entry's `platform` opt, never from the device-info adapter: the id is
persisted forever and `collect()` can throw on first run. `session.id` keeps the narrower
ios|android rule (§3.3 gives it `_web` in v4, not now) — that rule lives in
`generateSessionId()`, so the two ids can diverge without either drifting by accident.

**`device.id` is SDK-owned, `user.id` is consumer-owned** — contract §3.2, and the split is the
whole point. `device.id` is self-minted (never `getUniqueId()`, which carries two lifetimes on
RN alone), written through the `Store` under `telemetry_device_id`, uninstall-scoped, and it
**never rotates** — not on `identify()`, not on a user-id change, not on `clearUserProfile()`.
`user.id` is absent until the host app calls `setUserId` / `setUserProfile({userId})`; there is
no anonymous mint, no `""` and no placeholder — `setUserId("")` clears it rather than shipping
an empty string, and `clearUserProfile()` clears it too (§3.2) while leaving `device.id` alone — so `COUNT(DISTINCT device.id)` is anonymous
reach, `COUNT(DISTINCT user.id)` is known-user reach and `GROUP BY device.id` stitches the two.

When the `Store` reports `unavailable` on either the read or the write, the id lives for one
process only and **`device.id_ephemeral: true`** rides the Context block (omitted otherwise).
Without it that never-returning population inflates `COUNT(DISTINCT device.id)` and reads as
traffic growth.

### The Store port

Persisted state goes through `Store` (`core/store.ts`), a shared-core `get` / `set` / `remove`
interface with **no React Native import** — v4 moved `device.id` and session resume into shared
core, and the sticky sample rate and capped offline store follow, none of which can reach
AsyncStorage.

**The sync/async split is load-bearing, not an implementation detail.** `SyncStore`
(`adapters/web/store.web.ts`, `localStorage`) has finished its read when `get()` returns;
`AsyncStore` (`adapters/native/store.native.ts`, `AsyncStorage`) settles later. That is why the
crash-loss window closes on web and only narrows on native. Do **not** flatten the two behind a
uniform `Promise` — a caller must be able to depend on the web side being synchronous. Shared
code that doesn't care takes the `Store` union and `await`s either side.

Reads return `hit` | `miss` | `unavailable`. `unavailable` is a first-class path, not an error:
incognito, partitioned iframes, ITP eviction and full disks land there, and that population is
what `device.id_ephemeral` reports. Never throw out of a Store, and never collapse
`unavailable` into `miss`.

Each entry builds **one** store and hands it to both the sender and core, so an injected
store governs the offline queue too. `TelemetryOpts.store` overrides it — typed `SyncStore` on
the web build (its guarantee depends on that) and the `Store` union on native, which only ever
awaits. The offline queue in `webSender` / `nativeSender` is the port's first consumer. `memoryStore({ async?, unavailable?, seed? })` is a shipped in-memory
implementation — a production-shaped seam, not a test-only affordance — configurable to either
build's shape. A direct `new Telemetry()` with no injected store falls back to
`memoryStore({ unavailable: true })`, so shared core never has to special-case a missing one.

### Session lifecycle

Two boundaries and nothing else (§4.2). **Neither build rotates on a lifecycle transition** —
the native `background → finalize` / `foreground → newSession` pair was deleted to reach parity
with web, not mirrored onto it. Backgrounding on native still forces a `flush()`, because the
queue only lives in memory and that is when the process is most likely to be killed.

| Boundary | Rule |
|---|---|
| Idle | 30 min since the last non-session event → `rotateSession("idle")` |
| Maximum length | 4 h since `session.start` → `rotateSession("max_duration")` |

Both are checked lazily, in `log()` and again at init. Idle is tested first: a long session that
also went quiet ended because the user left.

The session record — `{id, start, lastActivity, sequence, eventCount, errorCount}` — is written
through the `Store` under `telemetry_session` on every non-session event and every acknowledged
batch. So **process death, tab close, hard reload and bfcache restore all resume** the session
when the gap is inside the idle window, and on web the record is `localStorage`, hence
browser-wide and shared across tabs. That is intended.

Each entry `await`s `resumeOrStartSession()` *inside* `instancePromise`, so `session.started` can
never land behind the host app's first event. It resolves one of three ways:

- record inside the window → **resume silently**. A resumed session must **not** re-emit
  `session.started`, or `COUNT(session.started)` stops equalling session count (§4.1).
- no record, corrupt record, or `unavailable` → fresh session, `session.reason: "launch"`.
- expired record → adopt it, emit `session.finalized` **under the old `session.id` and
  `session.start_time`**, then start a fresh one carrying the same reason.

`session.reason` ships on both: 3 values on `session.started` (`launch|idle|max_duration`), 2 on
`session.finalized` (`idle|max_duration`). `session.finalized` keeps `duration_ms` and
`event_count` even though the backend discards and derives both — the event survives as the
carrier for `session.reason` and `sdk.error_count`. `duration_ms` is stamped from `lastActivity`,
never `now`, so a lazily-detected rotation reports 2 minutes of use and not the 6 idle hours that
followed it.

### Event allowlist

`ALLOWED_NAMES` in `core/telemetry.ts`. Anything else is rewritten to `custom_event` with
the original name as `event.name`. Currently emitted:

| Event | Trigger |
|---|---|
| `session.started` / `session.finalized` | init (unless the session resumes), 30-min idle rotation, 4-hour cap |
| `app_lifecycle` | foreground/background transition |
| `navigation` | route change or `screenStart()` |
| `screen.duration` | `screenEnd()` |
| `http.request` | intercepted fetch (both) + XHR (web) |
| `app.crash` | JS error, unhandled rejection, console.error/warn |
| `user.interaction` | native taps via `interactionProps()` |
| `network_change` | connectivity type transition |
| `user.profile.update` | `identify()` |
| `custom_event` | any non-allowlisted `log()` name |
| `frame_render_time` | **metric** — p95 per 10s window |
| `memory_usage` | **metric** — used heap MB |

Allowlisted but with **no producer**: `page_load`, `resource_timing`, `long_task`, `LCP`,
`FCP`, `CLS`, `INP`, `TTFB`. These are the RN-Web track, not built yet.

**Adding a new `eventName` requires backend sign-off** — unlisted names are dropped on
ingest.

---

## Conventions

- `tsconfig.json` is the source of truth for compiler settings.
- The code uses `any` liberally in older paths. Prefer `unknown` and concrete types in **new**
  code; don't widen what's already typed.
- Public types live in `src/core/telemetry.ts` (`TelemetryEvent`, `Sender`, `DeviceInfo`,
  `UserProfile`, the `*Handler` interfaces). The one exception is the `Store` port, which lives
  in `src/core/store.ts` — it has to, since `telemetry.ts` imports it. A second port gets its
  own file too; anything else goes in `telemetry.ts`.
- Native adapters may use RN / `react-native-device-info` / `@react-native-async-storage` —
  **peer deps** (`device-info` optional). Web adapters must not import them.
- Guard native-only globals (`ErrorUtils`, `AppState`) before use.
- **No bare `console.log`.** All SDK-internal logging goes through `debug()` in
  `core/debug.ts`, off unless `debug: true`.
- A `Sender` implements `send()`, optionally `onFailure()` + `replayFailed()`. JSON only, via
  `buildBatch()`. No compression, no Protobuf.
- Non-trivial logic leaves one runnable check behind — a small `*.test.ts` next to the file.
  `npm test` runs vitest.

---

## Build, scripts, CI

- `npm run build` → `vite build` → `dist/`. `npm run typecheck` → `tsc --noEmit`.
  `npm test` → `vitest run`. `npm run clean` removes `dist/`.
- `prepare` runs the build, so a git-dependency install builds automatically.
- CI (`.github/workflows/ci.yml`): on push/PR to master + merge_group — `npm ci`, typecheck,
  test, build. Actions pinned by SHA. No lint step (no lint script in the repo).
- Publishing is **manual** (`npm publish`) — no release workflow.
- `dist/` and `*.tgz` are git-ignored and must stay untracked. If they show up in
  `git status`, something re-added them.

---

## Known gaps

Real, current, from `sdk-audit.yaml`. Flag before "fixing" — several need backend
coordination.

- `memory_usage` is **single-shot**: `trackMemoryUsage()` calls `recordMemoryUsage()` once;
  the periodic `start()` in the memory adapters is never invoked.
- `sdk.platform` is the constant `"react-native"` on the web build too, while
  `device.platform` is `"web"`.
- No URL sanitisation — `http.url` and web navigation paths keep query strings, so tokens
  and PII in query params ship as-is.
- `captureConsole` defaults ON, so every `console.error` becomes an `app.crash`.
- The offline store is **unbounded** — append-only, no cap or eviction. It now goes through
  the `Store` port, so the cap has somewhere to live, but capping it needs `sdk.events_dropped`
  and `sdk.drop_reason="store_full"` on the wire — v4, backend sign-off.
- `http.request_size` is string `.length` (chars), not bytes.
- No top-level `location` in the envelope, though the contract allows one.
- `apiKey` is only validated in the factory; the `TelemetryWeb`/`TelemetryNative`
  constructors still accept it as optional.
- `session.id` still omits the `_web` suffix on the web build; contract §3.3 gives it one in
  v4. `device.id` is already suffixed on all three platforms.
- Crash capture is JS-level only — no native signal/ANR/hang capture.
- `index.base.ts` `trackErrors()` imports the **native** crash handler in shared code; the
  web build resolves it at runtime and rejects.

---

## When in doubt

1. Touching capture logic? → shared logic in `adapters/*.ts`, platform APIs in the
   `.web.ts` **and** `.native.ts` pair. Never one without the other.
2. Touching the wire body? → it's a cross-SDK contract. Backend sign-off first.
3. New `eventName`? → it must be on the allowlist, and that needs backend sign-off.
4. New attributes? → flatten to dot-notation, keep values primitive.
5. New public method? → `async`, and add it to `TelemetryBase` if it's platform-agnostic.
6. New dependency? → peer dep? native-only? optional? Don't bundle RN/React.
7. Changed behaviour? → update `sdk-audit.yaml` in the same commit.
