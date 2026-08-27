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

- npm: `@nathanclaire/edge-telemetry-sdk`, currently **v3.0.1**. (v2 was the unscoped
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
│   └── utils/uuid.ts      ← randomHex() — one shared impl, no platform split
├── adapters/
│   ├── batch.ts           ← buildBatch(): the telemetry_batch envelope, shared by both senders
│   ├── appLifecycle.ts    ← AppLifecycleEmitter (edge-triggered foreground/background)
│   ├── crashCapture.ts    ← shared crash normalisation → app.crash
│   ├── httpAttributes.ts  ← shared http.* attribute builder
│   ├── frameAggregate.ts  ← rAF deltas → one frame_render_time metric per 10s window
│   ├── interaction.ts     ← user.interaction tap emitter
│   ├── networkChange.ts   ← edge-triggered network_change emitter
│   ├── navigationTracker.ts / screenTiming.ts
│   ├── webSender.ts / nativeSender.ts
│   ├── web/               ← *.web.ts capture adapters
│   └── native/            ← *.native.ts capture adapters
└── shims/react-native-web-shim.ts
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
  endpoint: "https://collector.example.com/collector/telemetry",
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
};
```

Methods (both classes, all return Promises):

```ts
log(event, data?) / flush() / shutdown()
identify({name?, email?, phone?, avatar?, customAttributes?})   // emits user.profile.update
setUserId / generateUserId / setUserProfile / setUserDetails / updateUserProfile
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

{
  "type": "telemetry_batch",
  "timestamp": "2026-06-14T10:30:00.512Z",   // ISO 8601
  "batch_size": 13,
  "events": [ /* Event | Metric */ ]
}
```

Built by `adapters/batch.ts` so both senders are byte-identical. Web uses
`fetch({keepalive:true})` — **not** `sendBeacon`, which cannot set the API-key header.
On failure: retried (3 attempts; native exponential + jitter, web linear), then persisted
(`AsyncStorage` native / `localStorage` web, key `telemetry_failed_events`) and replayed on
next init.

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
user.id, session.id, session.start_time (ISO), session.sequence
sdk.platform ("react-native"), sdk.version (package.json version)
app.*        name, version, buildNumber, packageName
device.*     id, platform, platformVersion, model, manufacturer, brand (+ OS-specific extras)
network.*    type, isConnected
user.*       name/fullName/email/phone/avatar/custom.* — only when a profile is set
```

Caller `data` is flattened dot-notation on top. Keep attribute values primitive.

### ID formats

```
session.id : session_{ms}_{16 hex}_{ios|android}   // suffix native only; web omits it
user.id    : user_{ms}_{16 hex}                    // never suffixed
device.id  : native getUniqueId(); web device_{ms}_{uuidv4}_web
```

Entropy is `Math.random()`, not crypto — deliberate, marked with a `ponytail:` comment.

### Event allowlist

`ALLOWED_NAMES` in `core/telemetry.ts`. Anything else is rewritten to `custom_event` with
the original name as `event.name`. Currently emitted:

| Event | Trigger |
|---|---|
| `session.started` / `session.finalized` | init, 30-min idle rotation, background (native) |
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
  `UserProfile`, the `*Handler` interfaces).
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
- The offline store is **unbounded** — append-only, no cap or eviction.
- `http.request_size` is string `.length` (chars), not bytes.
- No top-level `location` in the envelope, though the contract allows one.
- `apiKey` is only validated in the factory; the `TelemetryWeb`/`TelemetryNative`
  constructors still accept it as optional.
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
