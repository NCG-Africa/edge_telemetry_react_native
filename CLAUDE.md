# CLAUDE.md — edge-telemetry-sdk (React Native) Development Guide

This file is the source of truth for AI-assisted development on this project.
Read it completely before writing any code, generating files, or making suggestions.

> Sibling project: the Ionic/Angular/Capacitor SDK (`edge-rum`) targets the same backend.
> This repo is being brought up to parity with that one. Where current code and the target
> contract diverge, this doc says so explicitly — see **Current state vs target** at the end.
> Do not assume the Angular doc applies verbatim; this file wins for this repo.

---

## What this project is

`edge-telemetry-sdk` is a lightweight Real User Monitoring SDK for **React Native** apps
(and a web build via React Native Web). It captures performance data, errors, network
requests, device/network context, and navigation, then ships them as JSON to a custom
backend — the same EdgeTelemetryProcessor that ingests the Android and Ionic SDK data.

- Package name: `edge-telemetry-sdk` (npm), currently `v2.1.0`.
- Bundler: **Vite** (`vite build` → `dist/`). Not `react-native-builder-bob`.
- Dual entry: web (`dist/index.web.js`) and native (`dist/index.native.js`), selected via
  the `package.json` `exports` map and the `.web.ts` / `.native.ts` file-extension split.

---

## Architecture — read before touching anything

There is **no `packages/*` monorepo**. One `src/` tree, split by platform at the file level:

```
src/
├── createTelemetry.ts          ← factory: picks Web or Native at runtime
├── index.web.ts                ← TelemetryWeb class (public web entry)
├── index.native.ts             ← TelemetryNative class (public native entry)
├── core/
│   ├── telemetry.ts            ← Telemetry class: queue, batch, retry, session/user, log()
│   └── utils/
│       ├── uuid.web.ts         ← generateId() (web)
│       └── uuid.native.ts      ← generateId() (native)
├── adapters/
│   ├── webSender.ts            ← Sender for web (fetch / sendBeacon + localStorage replay)
│   ├── nativeSender.ts         ← Sender for native (fetch + AsyncStorage replay)
│   ├── navigationTracker.ts    ← shared route-change recorder
│   ├── screenTiming.ts
│   ├── telemetryMemoryUsage.ts
│   ├── web/                    ← *.web.ts capture adapters (deviceInfo, networkInfo,
│   │                             crashHandler, frameDrops, interceptFetch, memory, navigation)
│   └── native/                 ← *.native.ts capture adapters (same set, RN APIs)
└── shims/
    └── react-native-web-shim.ts
```

**Platform resolution is by filename, not by branching.** `index.native.ts` dynamically
`import()`s the `*.native.ts` adapters; `index.web.ts` imports the `*.web.ts` ones. Keep a
web and native implementation in lockstep when you add a capability — adding one without the
other silently breaks that platform.

### How a consumer wires it up

```ts
import { createTelemetry } from "edge-telemetry-sdk";

const telemetry = createTelemetry({
  endpoint: "https://collector.example.com/collect",
  batchSize: 20,
  flushIntervalMs: 10000,
});

await telemetry.setUserDetails({ fullName: "Ada", email: "ada@x.io" });
await telemetry.log("checkout_started", { cart_value: 42 });
telemetry.attachNavigation(navigationRef);   // native only, React Navigation ref
```

`createTelemetry()` returns `TelemetryWeb` or `TelemetryNative`. **Every public method is
`async`** because both classes lazily build the underlying `Telemetry` core behind an
`instancePromise` and await it on each call.

---

## Public API surface

### Factory options (`createTelemetry(opts)`)

```ts
type TelemetryOpts = {
  sender?: Sender;          // override the default platform sender
  batchSize?: number;       // events per flush. core default 2 (set this — 2 is too low for prod)
  flushIntervalMs?: number; // default 10000; <=0 disables the interval timer
  endpoint?: string;        // POST target. Default is a PLACEHOLDER — always pass a real one
};
```

### Methods (both `TelemetryWeb` and `TelemetryNative`, all return Promises)

```ts
log(event: string, data?: Record<string, any>): Promise<void>
flush(): Promise<void>
shutdown(): Promise<void>                 // clears the flush timer + final flush

setUserId(id: string)
generateUserId(): string
setUserProfile(profile: Partial<UserProfile>)
setUserDetails(details)                    // fullName/firstName/lastName/email/phone/avatar/customAttributes
updateUserProfile(updates)
getUserProfile(): UserProfile | undefined
clearUserProfile()
setUserName(fullName, firstName?, lastName?)
setUserContact(email?, phone?)

getDeviceInfo()
getNetworkInfo()
```

Native-only extras on `TelemetryNative`:

```ts
attachNavigation(navigationRef)            // React Navigation container ref
trackRoute(from: string, to: string)
screenStart(name) / screenEnd(name)
```

The trackers (`trackErrors`, `trackFrameDrops`, `trackNetworkRequests`, `trackMemoryUsage`,
`autoTrackNavigation`) are **auto-started in the constructor** — consumers don't call them.

---

## Wire format — what the SDK actually sends today

```
POST <endpoint>
Content-Type: application/json

{ "events": [ <TelemetryEvent>, ... ] }
```

- Native (`nativeSender`) and web (`webSender`) both POST `JSON.stringify({ events })`.
- Web prefers `navigator.sendBeacon` when available, else `fetch`.
- **No auth header**, **no batch envelope**, **no top-level timestamp/location/batch_size**.
- On failure: retried with exponential backoff + jitter, then persisted
  (`AsyncStorage` on native, `localStorage` on web, key `telemetry_failed_events`) and
  replayed on next init.

### `TelemetryEvent` shape (`src/core/telemetry.ts`)

```ts
type TelemetryEvent = {
  eventName: string;
  type: 'event' | 'metric';
  timestamp: number;                  // Date.now() — ms epoch (NOTE: ms, not ISO)
  userId?: string | null;
  sessionId?: string;
  attributes?: Record<string, any>;   // flat, dot-notation keys
};
```

`Telemetry.log()` builds `attributes` by flattening device info, network info, and the
caller's `data` with dot-prefixes, then merges identity + user profile:

```
device.*            from the DeviceInfoHandler
network.*           from the NetworkInfoHandler
<caller data keys>  flattened as-is
user.id             current userId (or null)
session.id          current sessionId
session.event_count running count
timestamp           new Date().toISOString()   ← ISO string, lives INSIDE attributes
user.fullName / user.email / user.custom.*  when a profile is set
```

Nested objects in `data` are recursively flattened with `flattenWithPrefix`; arrays are kept
as-is. Keep attribute values primitive where you can.

### ID formats (current)

```
session.id : "session_{Date.now()}_{8 chars}"      e.g. session_1719660000000_a8b9c2d1
user.id    : "user_{Date.now()}_{8 chars}"         e.g. user_1719660000000_x9y8z7w6
```

Random segment is `Math.random().toString(36)` (8 chars, no platform suffix). `device.id`
is **not** generated here — it comes from the device-info adapter.

---

## eventName values currently emitted

| Concept | `eventName` | Where |
|---|---|---|
| Route change (entry) | `navigation`, `navigation.route_change` | `navigationTracker.ts`, `adapters/*/navigation*` |
| Screen view / exit | `screen_view`, `screen_end` | `core/telemetry.ts`, `adapters/screenTiming.ts` |
| Screen dwell time | `performance.screen_duration` | `adapters/screenTiming.ts` |
| JS error / crash | `app.crash`, `app.error` | `adapters/*/crashHandler*` |
| HTTP request | `network_request` | `adapters/*/interceptFetch*` |
| Device context | `device_info` | `adapters/*/deviceInfo*` |
| Network context / change | `network_info`, `network_info_change` | `adapters/*/networkInfo*` |
| Frame drops | `frame_drop` | `adapters/*/frameDrops*` |
| Memory | `memory_usage`, `memory_pressure` | `adapters/*/memory*`, `telemetryMemoryUsage.ts` |
| Custom | whatever string the caller passes to `log()` | consumer code |

> These names are **not yet aligned** with the Android/Ionic backend contract
> (`http.request`, `app_lifecycle`, `session.started`, etc.). See **Current state vs target**.

---

## Conventions

### TypeScript
- `tsconfig.json` is the source of truth for compiler settings.
- The code currently uses `any` liberally (`Record<string, any>`, `instancePromise: Promise<any>`).
  Prefer `unknown` and concrete types in **new** code; don't widen what's already typed.
- Public types live in `src/core/telemetry.ts` (`TelemetryEvent`, `Sender`, `DeviceInfo`,
  `UserProfile`, the `*Handler` interfaces).

### Platform code
- Anything platform-specific goes in a `*.web.ts` **and** a `*.native.ts` file. Never branch
  on platform inside a shared file — let the bundler pick the file.
- Native adapters may use RN/`react-native-device-info`/`@react-native-async-storage` —
  these are **peer deps** (`device-info` is optional). Web adapters must not import them.
- Guard native-only globals (`ErrorUtils`, `navigator.product === "ReactNative"`) before use.

### Logging
- Production code is currently noisy with `console.log`. Do **not** add more. New diagnostics
  should be debug-gated, not unconditional `console.log`. (Cleanup of existing spam is tracked
  in **Current state vs target**.)

### Senders
- A `Sender` implements `send()`, and optionally `onFailure()` + `replayFailed()`.
- Always `JSON.stringify` the body. No compression, no binary, no Protobuf.
- Default endpoint is a placeholder (`https://your.telemetry.endpoint/collect`) — treat a
  consumer that doesn't pass `endpoint` as a misconfiguration.

---

## Build, scripts, repo hygiene

- `npm run build` → `vite build` → `dist/`. `npm run dev` runs Vite. `npm run clean` removes `dist/`.
- `dist/` and `*.tgz` are **git-ignored** and must stay untracked — `dist/` is regenerated by
  the build and published via `package.json` `files`; tarballs are local `npm pack` output.
  If you see them tracked again, something re-added them.
- `prepare` runs the build, so installing this as a git dependency builds it automatically.

---

## When in doubt checklist

1. Touching capture logic? → Add/maintain **both** the `.web.ts` and `.native.ts` adapter.
2. Touching the wire body? → JSON only, `{ events: [...] }`, no new headers without backend sign-off.
3. New `eventName`? → Confirm against the backend contract before shipping it.
4. Adding attributes? → Flatten to dot-notation; keep values primitive.
5. New public method? → It must be `async` and delegate through `instancePromise` on both classes.
6. Adding a dependency? → Is it a peer dep? Native-only? Optional? Don't bundle RN/React.
7. Build output or tarball showing up in `git status`? → It should be ignored, not committed.

---

## Current state vs target (the catch-up work)

The sibling Angular SDK already conforms to the EdgeTelemetryProcessor contract. This repo
does not yet. Known gaps, in rough priority order — **flag before "fixing" so we sequence them
with the backend team**:

| Area | Current (this repo) | Target (Android/Ionic contract) |
|---|---|---|
| Batch envelope | `{ events }` | `{ type: "telemetry_batch", timestamp, location?, batch_size, events }` |
| Auth | none | `X-API-Key: edge_...` header |
| Event `timestamp` | `Date.now()` ms number | ISO 8601 string |
| ID entropy | 8 chars, no platform suffix | `..._{16 hex}_{platform}` |
| `eventName`s | `network_request`, `device_info`, `screen_view`, … | `http.request`, `app_lifecycle`, `screen.duration`, … |
| API key validation | none | `apiKey` required, must start with `edge_` |
| CI (`.github/workflows/ci.yml`) | runs `yarn lint/typecheck/test`, `yarn example expo` — **none exist** (npm project, stub test, no `example/`) | working lint + typecheck + test + build |
| Console noise | unconditional `console.log` throughout | debug-gated only |
| Public naming | core class literally named `Telemetry`/`TelemetryEvent` | (Angular enforces a terminology firewall on the public surface) |

Treat this table as the backlog for bringing the RN SDK to parity. Each row is a discrete,
backend-coordinated change — not a free-for-all refactor.
