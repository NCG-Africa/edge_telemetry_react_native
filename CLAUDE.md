# CLAUDE.md — @nathanclaire/edge-telemetry-sdk (React Native) Development Guide

**The** source of truth for development on this repo. Read it before writing code.

There is no companion file. `sdk-audit.yaml` was retired: a second hand-maintained
description of the same behaviour drifts from the first, and two documents disagreeing is
worse than one being incomplete. Its known gaps and its backend sign-off asks were already
duplicated in this file and stayed. What went with it was a third copy of the per-event
field tables — type, null discipline, `always_present` — which `docs/backend-wire-contract.md`
pins and this file explains; and a `done | partial | na` feature checklist, which said nothing
Known gaps did not already say more precisely.

Two documents outrank this one, and only within their scope:

| Document | Authority |
|---|---|
| `docs/backend-wire-contract.md` | **every wire key** — name, type, null discipline, cardinality, enum domain. It is a cross-SDK contract; where it and this doc disagree, it wins. |
| `docs/wire-inventory.md` | a **historical record**, pinned to v3.0.1 at `9b7bf83`. Read it for what shipped then, never for what ships now. |

Anything else — architecture, conventions, why a decision went the way it did, what is still
broken — lives here. When the code and this doc disagree, the code won and this doc is the
bug: fix it in the same commit.

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
│   ├── breadcrumbs.ts     ← ring buffer (last 20) for error.breadcrumbs
│   ├── debug.ts           ← debug() gate; all SDK-internal logging goes through this
│   ├── store.ts           ← Store port: get/set/remove over persisted state, no RN import
│   ├── memoryStore.ts     ← in-memory Store, configurable sync or async
│   ├── userProfile.ts     ← §4.10 profile attributes: the caps, the bounded user.custom.* bag
│   ├── utils/json.ts      ← stringifyOrDrop(): JSON.stringify that drops instead of throwing
│   └── utils/uuid.ts      ← randomHex() — one shared impl, no platform split
├── adapters/
│   ├── batch.ts           ← buildBatch(): the telemetry_batch envelope, shared by both senders
│   ├── failedEvents.ts    ← offline-queue key + decode/encode, shared by both senders
│   ├── appLifecycle.ts    ← AppLifecycleEmitter (edge-triggered foreground/background)
│   ├── crashCapture.ts    ← §4.7 error surface: error.* keys, app.crash vs app.error
│   ├── viewManager.ts     ← the View entity: view.id/view.name, the `view` event, the ladder
│   ├── loadingTime.ts     ← shared network-settle: view.loading_time + the 4-value outcome
│   ├── traceManager.ts    ← §6 trace/span: carrier, three roots, three tiers, the outcome ladder
│   ├── traceHeader.ts     ← §6.4/§6.5 pure half: allowlist, `traceparent` parse/format, header I/O
│   ├── navigationRef.ts   ← React Navigation ref listener, shared (getCurrentRoute works on web)
│   ├── httpAttributes.ts  ← shared http.* attribute builder + http.route normalization
│   ├── xhrIntercept.ts    ← shared XMLHttpRequest patch (native's only chokepoint)
│   │                        idempotent, and one listener per instance — see below
│   ├── viewport.ts        ← §3.3 pure math: the four viewport keys, shared by both builds
│   ├── frameAggregate.ts  ← §5.1 pure math: p95, the measured target_fps, dropped_count
│   ├── webVitals.ts       ← §5.3 pure half: the four shared keys + the ten per-vital ones
│   ├── frameTracker.ts    ← the shared rAF loop; the window resets at every view boundary
│   ├── uiInteraction.ts   ← §4.6 role gate, the five-rung name ladder, the rage window
│   ├── networkChange.ts   ← edge-triggered network_change emitter
│   ├── navigationTracker.ts / screenTiming.ts
│   ├── webSender.ts / nativeSender.ts
│   ├── web/               ← *.web.ts capture adapters (+ store.web.ts over localStorage,
│   │                        webVitals.web.ts — the only `web-vitals` importer in the tree)
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
  batchSize: 50,
  flushIntervalMs: 30000,
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
  batchSize?: number;       // events per flush. default 50 (Android's, §9.4)
  flushIntervalMs?: number; // default 30000; <=0 disables the interval timer
  captureConsole?: boolean; // console.error → app.error, console.warn → breadcrumb. Default OFF
  debug?: boolean;          // SDK-internal diagnostics. Default off
  sender?: Sender;          // override the default platform sender
  store?: Store;            // override the default platform Store (see below)
  beforeSend?: BeforeSend;    // sync scrubbing hook, run at enqueue (see below)
  sessionSampleRate?: number; // 0.0-1.0, sticky per session; default 1
  traceHostAllowlist?: string[]; // bare hosts, exact, ports ignored; EMPTY by default (§6.4)
  buildId?: string;         // app.build_id — symbolication join key; omitted when unset (§4.8)
};
```

Methods (both classes, all return Promises):

```ts
log(event, data?) / flush() / shutdown()
identify({userId?, name?, email?, phone?, avatar?, customAttributes?})  // emits user.profile.update
setUserId / setUserProfile / setUserDetails / updateUserProfile
getUserProfile / clearUserProfile / setUserName / setUserContact
trackErrors({captureConsole?}) / getDeviceInfo() / getNetworkInfo()
captureError(error: unknown, context?)   // emits app.error — never app.crash
```

`attachNavigation(ref)` lives on `TelemetryBase` and works on **both** builds: React Navigation's
`getCurrentRoute()` is a navigation-tree API, not a native one, so one wiring gives web and native
the same `view.name`.

Native-only on `TelemetryNative`: `trackRoute(from, to)`, `screenStart(name)`, `screenEnd(name)`,
`trackTap(name)`, `trackMemoryUsage()` — the last is native-only because `memory_usage` is (§5.2).

`trackErrors`, `trackFrameDrops`, `trackNetworkRequests`, `autoTrackNavigation`, (native)
`trackMemoryUsage` and (web) `trackInteractions` + `trackWebVitals` are auto-started in the
constructor — consumers don't call them. `trackWebVitals` is additionally **private**: there is
nothing to configure, and a vital that only fires if someone remembered to call a method is a
vital nobody has.

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
`Sender.onFailure()` returns how many rows the store's cap evicted, because the counter it
feeds (`sdk.events_dropped`) lives on the Context block and only core assembles that.
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
event.sequence         — per-session ordinal, stamped AFTER beforeSend; the backend's dedup key
user.id                — only when the consumer supplied one; omitted on anonymous traffic
device.id              — SDK-minted, persisted (+ device.id_ephemeral: true when storage failed)
session.sample_rate    — the rate this session was rolled at; every row of it carries it
view.id                — `view_{ms}_{16hex}`; never spans a `session.id` and never spans a process
view.name              — resolved at log time by lookup on the frozen `view.id`; `"unknown"` until named
sdk.platform            `react-native-{ios|android|web}` — a framework-OS compound (§3.3)
sdk.version (package.json version)
sdk.hook_dropped / sdk.hook_failed  — beforeSend counters; separate on purpose
sdk.events_dropped     — monotonic, process-lifetime; 0 until the first drop
sdk.drop_reason        — omitted until a drop; queue_full | store_full | rejected
app.*        name, version, build_number, package_name
app.build_id           consumer-supplied symbolication join key; omitted when unset, never "" (§4.8)
device.*     platform, platform_version, model, manufacturer, brand (+ OS-specific extras)
device.cpu_abi / .low_ram          NATIVE ONLY — "does this crash only on cheap devices"
device.screen_density / .screen_width_px / .screen_height_px / .orientation
                       both builds, never null; CSS/dp x pixel-ratio on web and native alike
network.*    type, is_connected
```

**The block is frozen at §3.3's 39 keys (#108), and absence is the null discipline.** A key the
SDK has nothing for is **omitted from the attribute bag itself**, not shipped as an `undefined`
that `JSON.stringify` happens to drop — so `device.android_sdk` appears nowhere on a web row, and
`beforeSend` is never handed a key that would not have shipped. `src/context.web.test.ts` and
`src/context.native.test.ts` assert the set key-by-key, present *and* omitted, on both builds.

**`device.fingerprint` and `device.iosDeviceName` are gone outright** (§3.4), along with the six
retired `user.*` fields: a build string that merges handsets — deleting it *repairs* device
identity — and the user's own name for their phone. Neither is collected any more; the
device-info adapter no longer calls `getFingerprint()` or `getDeviceName()` at all.

**`device.orientation`, `network.*` and device state stay log-time** (§3.1), because a request
that failed when the network dropped is better described by the network at completion.

Caller `data` is flattened dot-notation on top — so it can override any `app.*`, `device.*` or
`network.*` key, but **not** the identity keys, which are assembled after it. Keep attribute
values primitive.

### The attribution freeze (§3.1)

`Telemetry.snapshot()` + `LogSnapshot`, applied in `log()` after `collectContext()` so a caller's
`data` can never forge it. A **span-carrying** row reports the identity live at **span start**:

| Key | Resolved at |
|---|---|
| `session.id`, `session.start_time`, `view.id` | **span start (frozen)** |
| `view.name` | **log time, by lookup on the frozen `view.id`** — `ViewManager.nameOf()` |
| `network.*`, `device.orientation`, device state, `user.*` | log time |
| `session.sequence`, `event.sequence` | log time — transmission ordinals, not attribution |

Freezing `session.id` is not optional: §4.2's 4-hour cap can rotate a session **while a request is
in flight**, which would otherwise put S1's trace on an S2 row and break the invariant §6.6 tells
you to assert. Point events — `app.crash`, `custom_event`, `app_lifecycle`, `network_change`,
`user.profile.update`, every metric — pass no snapshot, so the freeze is a no-op on them.

**The mint/emit split and the freeze are one mechanism.** `ui.interaction` snapshots at the click
(and overrides the row's `timestamp` with it, via `LogSnapshot.at`); `http.request` snapshots at
**send** and leaves `at` unset, keeping the completion timestamp §4.4 gives it.

⚠ **`view.name` is resolved, never replayed.** A rung upgrade inside the emit window renames the
view *in place* — `view.id` never moves — so a deferred row shows the upgraded name. It has to:
a row carrying `"Home"` against the id now named `"Checkout"` would disagree with itself, which is
exactly what §3.1's lookup rule exists to prevent. **The freeze is on the id and the timestamp.**

`ViewManager.nameOf(id)` reads the live view, then a bounded ring of retired names
(`MAX_RETIRED_VIEW_NAMES`, 16). A span outliving 16 view boundaries degrades to `"unknown"` —
which is what a never-named view reports anyway. ⚠ The bound is a leak guard, **not** a claim
that no request lives that long: §4.5.2's 30 s cap is `view.loading_time`'s, and an XHR has none.

### ID formats

```
session.id : session_{ms}_{16 hex}_{ios|android|web}
device.id  : device_{ms}_{16 hex}_{ios|android|web}
user.id    : whatever the consumer passes, truncated to 255 — never minted here
```

Entropy is `crypto.getRandomValues` (#91). RN has no WebCrypto, so the native entry
side-effect-imports `react-native-get-random-values` (already a dependency) before the first
id is minted; it is a no-op wherever `crypto` already exists. There is **no `Math.random()`
fallback** — `randomHex` throws with a reinstall instruction instead, because a weak id that
persists forever is worse than refusing to mint one.

The suffix comes from the entry's `platform` opt, never from the device-info adapter: the id is
persisted forever and `collect()` can throw on first run. ⚠ **`session.id` gained `_web` in v4**
(#108, §3.3 / §12's item 13), so the two ids now follow one rule — a value-shape change on the
web build, and nothing parses it.

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

### `http.request` — one chokepoint, no URL

Native patches **`XMLHttpRequest` only**. RN's `global.fetch` *is* XHR underneath, so patching
both would emit two events per `fetch()` call; the single chokepoint also catches axios, which
is why an axios app's HTTP dashboard was empty before #95. Web keeps its `fetch` patch **on top
of** the XHR one, because browser `fetch` is native and not XHR-backed. The XHR half is shared
(`adapters/xhrIntercept.ts`) so the two builds cannot drift.

**`http.url` and `http.path` are removed outright** (§9.1) — not query-stripped. The identifier
lives in the *path*, so stripping `?token=…` while shipping `/accounts/GB29-…` raw fixes nothing.
`http.host` (keeps the port) and `http.route` replace them. §4.4 omits the host on a **native**
relative URL specifically — a browser resolves `/api/x` against the page, so `splitUrl()` passes
`location.href` as the base when there is one. That is a capability check, not a platform branch.

`http.route` is normalized **SDK-side only** — nothing raw leaves the device and the processor
never re-derives. The rule is §4.4.1 verbatim, in `normalizeRoute()`: a segment is a variable if
it contains a digit or runs 32+ chars, **except** `/^v\d+$/i`, so `/v2/` survives; depth caps at
6 with a trailing `/…`; `/` stays `/`; no case folding; trailing slash dropped. There is **no
cardinality guard** — a client-side rolling collapse would make one row mean different things on
different phones. Accepted residue: `/accounts/savings` survives as itself.

`http.request_size` is **true UTF-8 bytes**, and measures everything measurable *without
consuming the body*: strings and `URLSearchParams` by byte count, `ArrayBuffer`/`TypedArray` by
`byteLength`, `Blob` by `size`. `FormData` and streams are **omitted** — draining a consumer's
request body is a worse bug than a missing key.

⚠ **The two size keys have deliberately opposite null disciplines and must not be unified.**
`http.request_size` is *"omitted when unmeasurable, **never 0**"*, so a zero-length body ships no
key at all; `http.response_size` omits an absent `content-length` but **ships a real `0`**. `http.method` is uppercased in the shared builder, **reporting only** — the
forwarded request is never touched. `http.status_code` is **`0`** on transport failure (DNS, TLS,
timeout, cancellation) with no invented discriminator, so those stop folding into 5xx.

**Invariant: an `http.request` never contains the collector endpoint.**

### The View entity

`adapters/viewManager.ts`, shared by both builds because none of it is platform-specific. It owns
`view.id` + `view.name` on the Context block of every row, the `view` event at exit, and the name
ladder. The initial view **opens at SDK init**, so `view.id` is never absent.

**Four lifetime boundaries and nothing else** (§4.5): route change, background, session rotation,
process death. `view.id` **never spans a `session.id` and never spans a process** — so
`rotateSession()` emits the departing view *before* `finalizeSession()`, and `newSession()` mints
the successor *after* the new `session.id` is in place. Process death emits nothing at all: a
killed view's dwell is lost by design, because the alternative is a persist on every frame.

**One screen visit can produce several `view` rows** — a background/foreground round trip splits
it. Sum by `view.name`. That is the price of the event flushing while the app is reliably alive.

**`view.time_spent` is foreground-only.** The background boundary mints the successor immediately
(`view.id` must never be absent) but starts its clock *paused*, so a night spent backgrounded is
not charged as dwell to whatever screen was left open.

**The name ladder is rank-beats-order** (§4.5.1): `explicit` > `route` > `url` > `none`.

| Arriving rung vs. current | Result |
|---|---|
| higher | re-stamps `view.name`; **`view.id` unchanged** — an upgrade, not a navigation |
| lower | ignored outright, whenever it arrives |
| same, different name | a genuine navigation: emit the `view` event, mint a successor |
| same, same name | nothing |

Rungs 1 and 2 are **never normalized** — a host naming a screen `"Step 2 of 3"` must not receive
`"Step {id} of {id}"`. Rung 3 (web history only) reuses `normalizeRoute()` and drops the query.
There is **no `view.url`** and no cardinality guard, for the same reasons `http.route` has neither.

⚠ **`view.name` is mutable within a view's lifetime.** Rows emitted in the upgrade window — single-
digit milliseconds, between a route event and a mount effect — carry the lower rung's name. **The
`view` event's `view.name` and `view.name_source` are authoritative**; the Context-block copy is a
join-free convenience.

**`view.loading_time` is network settle, one shared module, both builds** (`adapters/loadingTime.ts`,
§4.5.2). In-flight `fetch`/XHR is the one signal both builds genuinely have — DOM-mutation quiet is
meaningless under React's re-rendering and rAF quiet never settles against RN's animation driver —
so web and native run the *same module* rather than one column name over two meanings.

| Rule | Why |
|---|---|
| quiet window **1000 ms**, subtracted back out | it is detection delay only, and free because the `view` event emits at view *exit*, not at settle |
| a request starting during an already-quiet period does **not** reopen the view | or a 30-second poller re-arms forever |
| hard cap **30 s**, emitting **null, not the cap** | a spike at exactly the cap makes 30 s and 90 s the same row |
| zero network is **null, never 0** | a `0` makes p75 track the *cache-hit rate*, so a backend caching win renders as a frontend regression, reversed |
| scope is everything **except the SDK's own collector POST** | the user waits on third-party widgets too |
| `initial_load` seeds from the platform's runtime-ready marker | `loadEventEnd` on web, `performance.rnStartupTiming` on native. A platform with no marker seeds `undefined`, which *releases* the gate — a marker that never arrives must not make every launch report `abandoned` |

⚠ **The 1000 ms quiet window is the same constant as §4.6's dead-click window** — `QUIET_WINDOW_MS`,
one constant, not two. `ui.dead` must import it rather than declare a second `1000`.

**`view.loading_time` is omitted when null**, following the general absent-means-nothing discipline
(§4.11 names `navigation.from_screen` as the SDK's only explicit wire null).
**`view.loading_time_outcome` always ships** — `settled` | `no_activity` | `capped` |
`abandoned` — because it is what tells the null causes apart. Read **two** series: p75 where
`outcome = 'settled'`, and **% `capped`**. A naive `AVG(loading_time)` mixes populations.

⚠ §4.5 says "null has **four** causes"; only three of the four outcomes are null-bearing
(`settled` carries the number). The fourth is not identified in the contract and is not produced
here — see the known gaps.

**`abandoned` means the user left while it was still loading, and nothing else.** A view exiting
*inside* the quiet window still reports `settled`: no further request can start in a view that is
exiting, so quiet is confirmed by construction and the rest of the window is detection delay.
Calling that `abandoned` would drop the fastest views out of the `settled` population and bias the
p75 the column exists to serve, in the wrong direction.

⚠ **A view that was never gated on the marker ignores the seed.** On web the `load` event
routinely arrives *after* the first route change; flooring that view's settle at the page's load
time would charge the launch's cost to a route change. Enforced in `NetworkSettle`, not assumed by
the caller.

**Free invariant, asserted on both builds: `loading_time_outcome = 'no_activity'` ⇔
`view.request_count = 0`.** That is why the runtime-ready marker is a *floor on when settle may
happen*, not a source of activity — a launch that fetched nothing reports `no_activity`, not the
platform's own startup time.

⚠ **`view.request_count` and `view.loading_time` both count requests *started* in the view**, so
both are booked by the interceptors at **send** time, not by `log()` at completion. A request in
flight across a view boundary belongs to the old view and does not hold the new one open.

**`navigation` and `screen.duration` are unified onto this module on native**, which fixes the v3
defect where `attachNavigation` never touched `inst.screens` — so a React Navigation consumer
emitted `navigation` on every route change and **never a single `screen.duration`**. A deprecated
event therefore starts firing where it never has, and its v4 volume goes *up*. Both are gated on
the `deprecatedScreenFeeds` opt, which the **web** entry sets `false` so a now-shared
`attachNavigation` cannot start `screen.duration` on a build that has never had it. ⚠ The flag does
**not** silence `navigation` on web — `navigationWeb.web.ts`'s history path emits it directly, as
it always has. §4.0 says web should emit neither; closing that is a separate change.

**`ViewManager.onBoundary()` is the view-boundary seam** (§5.1, #104). A subscriber is awaited
inside `beginView` while the departing view is still current — that is what lets the frame window
close on the screen the user is leaving rather than the one arriving. It fires on the route-change
and background boundaries only; ⚠ **`session_rotation` is excluded**, and the Metrics section
below says why.

**The background boundary must be awaited before the flush.** `AppLifecycleEmitter.onState` returns
a promise for exactly this reason: backgrounding forces a `flush()` because the queue only lives in
memory, and the `view` row the boundary emits is the row that flush exists to rescue. Firing the
flush on the next line sends the batch before the row is enqueued.

⚠ **Both builds flush there now.** Web did not until #106: web's queue is in memory too, and §5.3's
CLS and INP are *held* across the whole page load and drained at this boundary precisely because the
`web-vitals` library's own page-hide report loses them on a closed tab — holding them and then not
flushing would move that defect rather than close it. Web's sender is `fetch({keepalive:true})`,
which is what lets a hidden tab's batch outlive the document.

### `ui.interaction`

`adapters/uiInteraction.ts` (the shared rules) + `adapters/web/interactionWeb.web.ts` (the DOM
wiring), §4.6, #102. Replaces `user.interaction`, which is **off the allowlist**; `ui.screen` is
never emitted. The `rum_ui_interactions` columns already exist backend-side.

**Every click emits, actionable or not.** Suppressing the role-less ones would destroy dead-click
detection at the source, and it is what makes `unnamed` readable *against* `surface`.

**The name ladder is five rungs, gated on element role.** Rungs 2–5 read the nearest ancestor in
`composedPath()` that is actionable **by role** — `<button>`, `<a href>`,
`<input type=submit|button|reset>`, `<summary>`, `<option>`, or
`role=button|link|tab|checkbox|radio|switch|menuitem|option`. Deriving only from role-bearing
elements is what keeps a clickable div full of customer data from being auto-named; on RN-Web
`createDOMProps` maps the `role` prop onto a semantic element, so a `Pressable` lands there for
free.

| # | Source | `ui.name_source` |
|---|---|---|
| 1 | `data-edge-action-name` — **works on role-less elements, always wins, unnormalized and uncapped** | `edge_action` |
| 2 | `data-testid` — read, never written | `test_id` |
| 3 | `aria-label` | `aria_label` |
| 4 | `title` | `title` |
| 5 | `textContent` | `text` |
| — | nothing survived | `none` |

Rungs 2–5 are normalized — trim, lowercase, non-alphanumeric → `_`, collapse runs, **cap 64** —
and edge underscores are dropped, so `"Add to cart!"` is `add_to_cart`. Rung 1 passes through
byte-for-byte: it is explicit author intent and a consumer must be able to predict the value they
just set.

**Three unnamed values, not two.**

| Click lands on | `ui.target` |
|---|---|
| role-bearing, a rung matched | the derived name |
| role-bearing, nothing survived | `unnamed` — an instrumentation gap worth closing |
| role-less, `cursor: pointer` | `unnamed` — same gap |
| role-less, default cursor | `surface` — whitespace, nothing to fix |

Collapsing the last two gives `40% unnamed` with no way to tell missing instrumentation from
people tapping padding.

⚠ **The role gate is a proxy, not a privacy guarantee.** `<button>Delete John Kamau</button>`
still ships that text. `beforeSend` is the answer and there is deliberately **no second
per-element masking mechanism** — no mask attribute, no placeholder mode.

⚠ **`ui.tag` is the *resolved* element's tag**, not the click target's — a click on the `<span>`
inside a `<button>` reports `button`.

**The mint/emit split is the whole reason `log()` takes a third argument.** An actionable click is
emitted a full dead-click window *after* it happened, so its wire `timestamp` and its `view.id` /
`view.name` / `session.id` are snapshotted at the click and replayed by `Telemetry.snapshot()`.
Stamping emit time would attribute a navigating tap to **the view it opened**, silently inverting
every "which screen frustrates users" query.

**`ui.rage`** is ≥3 clicks in a 1000 ms sliding window **on the same live element node**, flagged
**once per burst** on the crossing click — so *rage bursts = count of flagged rows*. ⚠ Identity is
the node reference, **never `ui.target`**: three clicks on three different `unnamed` divs are
indistinguishable on the wire, which is precisely why this runs client-side. **Omitted when
false**, deliberately asymmetric with `ui.dead`.

**`ui.dead`** is no DOM mutation (attribute-only counts — a CSS class flip is alive), no request
started and no navigation within **1000 ms**. ⚠ **The same constant as §4.5.2's quiet window** —
`QUIET_WINDOW_MS`, imported from `loadingTime.ts`, never a second literal `1000`. Aliveness reaches
the tracker through `ViewManager.onActivity()`, the one seam requests and view mints already pass;
DOM mutation it observes itself, and only while a window is open. **Omitted when not evaluated** —
a non-actionable click, text entry, a `download`/`_blank` anchor, or a runtime with no
`MutationObserver` — and that absence is load-bearing: the signal **under-reports by construction
and never falsely accuses**, since routine React re-rendering makes dead clicks read *alive*.

**Error click spends no key.** It is the join — a `ui.interaction` whose `rum.action.id` appears on
an `app.crash` or `app.error` row **where `trace.root_type = 'interaction'`**. ⚠ That filter is not
optional; without it the signal absorbs launch and route-change errors. No fourth causality window
was invented.

**Native is explicit-only: `trackTap(name)`** (§4.6, #103, on `TelemetryNative`).
`interactionProps()` is deleted, not renamed: it sat on the consumer's **root** `<View>`, where
`PressEvent.nativeEvent.target` is a node tag number with no public API resolving it, so it could
not tell a tap on a button from a tap on padding and every row it emitted was un-nameable. There is
no role model to gate on and no DOM to derive from, so anything auto-derived would be wrong or a PII
leak.

`name` is rung 1's equivalent — explicit author intent — so it ships **unnormalized and uncapped**,
and `ui.name_source` has exactly **two** values: `edge_action`, or `none` for a blank name, whose
`ui.target` is `unnamed`. **`surface` never appears** — it only means something where role-less
elements exist. `ui.tag` is the constant `"native"` and `ui.x`/`ui.y` are `0`: §4.6 types all three
never-null and there is no element and no coordinate to report. **`ui.dead` is absent from every
native row**, never `false` — no DOM, hence no mutation signal (⚠ any dead-click *rate* must filter
to the web build).

⚠ **The mint/emit split is real on native too, and for the same reason.** The row's `timestamp`,
`view.id`, `view.name` and `session.id` are snapshotted **synchronously inside `trackTap`**, because
the host's press handler navigates on the very next line while the emit rides a promise. That is
what `TelemetryNative.ready` — the resolved core, cached the moment `instancePromise` settles —
exists for; a tap arriving before init falls back to emit-time identity, which is the launch view
either way.

**Native rage is gated to named taps**, and its identity is the **name**, not a node: on native the
name *is* the element. Running it over `unnamed` would invent a frustration event that never
happened, so ⚠ **a low native rage count means few named taps, not happy users**.

### Trace and span

`adapters/traceManager.ts`, shared by both builds (§6, #98/#99). It owns the live-root
**carrier**, root minting, the key builders for the three tiers, and §6.5's outcome ladder.
`adapters/traceHeader.ts` is the pure half — allowlist normalization, `traceparent`
parse/format and header reading — so both builds cannot drift on the rules.

**`rum.action.id` is the root's `span.id`**: `== span.id` on a root, `== parent.span.id` on a
child. That identity is the single thing that makes an action's envelope one `GROUP BY` instead of
a self-join. `trace.root_type` is denormalized onto every child so launch traffic separates from
tap traffic without joining back to the root.

⚠ **No request tag and no thread-local.** Android's `Call.Factory` tag and its process-global
`lastRoot` exist to defeat OkHttp's dispatcher-pool threads; both RN builds patch a
single-threaded JS transport, so a plain field read synchronously inside the patch is correct
**by construction** (§6.7). The crash and unhandled-rejection handlers read the carrier directly.
The carrier is a field on a `Telemetry`-owned manager rather than §6.7's literal module-level
`let`: a module singleton would let one `Telemetry` inherit another's live root inside one
process, which is the hazard that actually exists here. `ViewManager` is owned the same way.

| Root | Minted | `trace.root_type` |
|---|---|---|
| `app.start` | once per process, in the `Telemetry` constructor | `launch` |
| `view` | at view **entry**, when no root is live | `navigation` |
| `http.request` | at **send**, when no root is live | `request` |
| `ui.interaction` | at **every** click — the one unconditional mint | `interaction` |

⚠ **A click mints unconditionally**, replacing whatever root was live rather than joining it: a
tap is a new user action by definition, which is what makes the request a tap fires a child of the
tap and not of the route change before it. On native the same mint rides `trackTap(name)` (#103). The launch root is minted **before** `ViewManager`, so the initial view is
its child and **a web hard load is `launch`, never `navigation`**. Web's launch span starts at
`performance.timeOrigin`, native's at SDK `initialize()`; neither is a fork time and the two are
**not the same interval** — do not compare native and web launch envelopes.

**Three tiers.** Tier 1 span-carrying: `app.start`, `view`, `http.request`, `ui.interaction`. Tier 2 annotation-only — `trace.id`, `rum.action.id`, `trace.root_type`, no span:
`app.crash`, `app.error` and `custom_event`. ⚠ `custom_event` is the one place RN goes
past Android, flagged as an invention. **Tier 3 is trace-free**: *all metrics*, plus
`app_lifecycle`, `network_change`, the session events, `user.profile.update` and the deprecated
feeds. A windowed aggregate belongs to no single action, and a `rum.action.id` on a p95 would
invite a `GROUP BY` over a number that was never attributable — and the join would look valid.

**Tier 2 never mints**: with no live root it carries no trace keys at all, rather than inventing a
root nothing else will join.

⚠ **`view` carries `span.start_time` but never `span.duration_ms`, not even as a child.** View
dwell is `view.time_spent`, not span width: with a duration, `MAX(child.start + child.duration) −
root.start` would stretch every tap-that-navigates envelope across the entire time the user sat on
the screen. Omitting it makes `view` a **point span**, and `NULL` drops out of the `MAX`.

⚠ **A `view` row parents to the root live at view *entry*** — the action that opened the screen,
not the one that closed it. Its wire `timestamp` is the exit and its `span.start_time` the entry,
so **a navigation root's row arrives after its own children**. On RN that is the normal case.

**`span.duration_ms` is Tier 1 children only** — a root's is derived server-side at query time.

**Expiry is 2 s idle / 10 s cap**, Android's numbers, as **internal constants and never
`TelemetryOpts` surface**: `injected_expired` exists so the numbers are falsifiable, so ship
Android's and tune on evidence. A span's *start* extends the root; a view's *exit* does not. The
clock is `Date.now()`, and a **negative delta is clamped to expired** — an NTP correction must not
hold one root open forever. **Background and session rotation both clear the carrier**: a resumed
app's first fetch mints its own root, and `trace.id` never spans a `session.id` (§6.6).

The invariants worth asserting: `trace.id` never spans a `session.id`; `rum.action.id` **may**
span a `view.id`, and §6.6 states the absence of a third invariant rather than letting you infer a
hierarchy. An action genuinely outlives its view — a root minted in A, a route change to B that
*extends* it, and B's mount fetch as a child of an A-minted root: one `rum.action.id`, two
`view.id`s, every row correct.

#### Header injection — `traceHostAllowlist` and the outcome ladder

**Tracing is dark by default** (§6.4): `traceHostAllowlist` is **empty**, so upgrading to v4
cannot break a consumer's network calls on day one. It is **constructor-only**, bare hosts,
**exact match**, punycode-normalized, and **ports are ignored** — ⚠ a deliberate mismatch with
`http.host`, which keeps the port. **Do not join them.** No wildcards, no regexes, no
predicates, no same-origin exemption: listing a host is the consumer's assertion that *that
host's* CORS config allows the header, and you cannot make that assertion over a pattern.

A **malformed entry throws in `__DEV__` and is dropped in production**, reported through
`debug()` — so it is silent unless the consumer passed `debug: true`, like every other
SDK-internal diagnostic. A RUM SDK crashing a shipped banking app over a config typo is the one
failure worse than no tracing.
The throw is raised in the **synchronous `createTelemetry()` factory**, not in core: core is
built inside `instancePromise`, which deliberately never rethrows, so a throw there would be a
silently rejected promise instead of the loud config error dev is asking for.

**`traceparent` only. No `b3`, no `tracestate`, ever.** The SDK **reads exactly one header
name** (case-insensitively, for exactly one purpose — a presence check) and **writes exactly
one header name**. That is a sentence a consumer must be able to state during a security
review. Every extra header is another line the customer's server team must add to
`Access-Control-Allow-Headers`, and a *partial* CORS config is worse than none.

⚠ **The failure signature to hand a customer:** *"our app broke after we enabled tracing"*
means `Access-Control-Allow-Headers: traceparent` is missing on that host, not that the SDK is
broken. Adding the header also converts previously-*simple* cross-origin GETs into preflighted
ones — set `Access-Control-Max-Age`.

**Never-strip**: the SDK never removes or rewrites a header it did not add. Ownership is a
**per-request presence flag set at the consumer's write time** — the `setRequestHeader` patch
on XHR, `init.headers`/`Request.headers` on fetch — **never inferred from the value's shape**,
because an SDK-minted and a consumer-minted `traceparent` are byte-identical by construction.
The fetch path forwards a **copy** of the headers, so the consumer's `Request`/`Headers` object
is never mutated.

**No retry-without-the-header and no preflight probe**, both declined on the record: a rejected
preflight and a dead server are the same `TypeError`, so retrying would **double-send a
non-idempotent POST** — a tracing feature must not be able to double-charge a card. A
*consumer's own* retry re-enters the patch and gets a **fresh `span.id`**: each attempt is its
own `http.request`, so each attempt is its own span.

**`traceparent.outcome` — 7 values, precedence is table order, absent means not traced.**

| # | Value | Fires when |
|---|---|---|
| 1 | `skipped_off_allowlist` | an allowlist exists and this host is not on it |
| 2 | `skipped_no_cors` | **fetch-only** — `mode` is a concept XHR cannot express, so no platform branch is needed |
| 3 | `skipped_consumer_set` | consumer header present and **unparseable** |
| 4 | `adopted` | consumer header present and **valid** |
| 5 | `injected_attributed` | a live root was joined |
| 6 | `injected_expired` | the carrier had aged out — context lost |
| 7 | `injected_unattributed` | there was no carrier at all — no action |

`injected_unwired` is **dropped** relative to Android and must not come back: it exists there
because `instrument(client)` is a wiring step a consumer can get wrong, and **both RN builds
patch the transport in the constructor**. A permanently-zero bucket is eventually read as
healthy.

**Every skip still stamps local ids with no wire header** — that is what makes *"missing DB
join ⇒ header stripped in transit"* computable. **`adopted` is the exception**: the row mirrors
the consumer's ids (`span.id` is the foreign parent-id, §6.1), omits `parent.span.id` and
`trace.root_type`, and **leaves the carrier untouched** — extending a local root off a request
reporting foreign ids would attribute their action to ours.

⚠ **An unsampled session injects no header at all** — not a `flags=00` id. Sampling stays
session-level; the injected flags byte is always `01`.

`session.started` carries **`sdk.trace_allowlist_size`** (§4.1) — **count only, never the
hosts**, so a zero tells "nobody opted in" apart from "the header is being stripped" without
shipping a customer's internal hostnames.

⚠ Per the fetch spec a **non-empty `init` resets a `Request`'s `referrer` and `referrerPolicy`**.
The web patch carries both across when the consumer passed none, so adding our header is not a
behaviour change the SDK was never entitled to make.

`injected_expired` vs `injected_unattributed` is decided by reading the carrier field **before**
`liveRoot()` drops an expired root. That is the split §6.5 asks the backend to keep as
`injected_unattributed_context_lost` / `_no_action`.

### The error surface

`adapters/crashCapture.ts`, shared by both builds (§4.7, #100). **Two names, not one.**

| | `app.crash` | `app.error` |
|---|---|---|
| Means | unhandled / fatal-ish | handled / non-fatal |
| Producers | `ErrorUtils` / `window.onerror`, unhandled rejection | `captureError()`, opted-in `console.error` |
| `error.breadcrumbs` | ✓ | — |
| `error.fatal` | native only | — |

The reason is one query: **crash-free rate is `COUNT(event_name='app.crash') / sessions` with no
`WHERE` clause** — the metric people dashboard, and the one that silently breaks when someone forgets
the filter.

**There is no public path to `app.crash`.** A consumer's own code must not be able to manufacture
rows in the one table an unfiltered count is read from — which is also why `eventName` is Tier A
immutable in `beforeSend`. The block lives on **`TelemetryBase.log()`**, so the SDK's own handlers,
which hold the core `Telemetry`, are unaffected. ⚠ A caller-supplied `app.crash` is **routed to
`app.error`**, not dropped: a reported error is data, it just isn't a crash.

**All five `crash.*` keys are retired for dotted `error.*`, and both explicit wire nulls go with
them** — the SDK's omitted-means-absent discipline is now universal.

| Key | Rule |
|---|---|
| `error.type` | from **`error.name` only, never `constructor.name`** — minification turns `class PaymentError` into `"a"`, refragmenting grouping on every deploy. Cap 255; un-named classes report `"Error"` |
| `error.source` | 5 values: `global_handler`, `unhandled_rejection`, `cross_origin` (web), `console`, `reported` |
| `error.message` | omitted when absent. Cap 1000 |
| `error.stacktrace` | omitted when absent. **Raw and byte-for-byte** under the cap. Cap 2000, **tail-truncated on a frame boundary** |
| `error.fatal` | **native only, omitted on web** — always `false` on `app.error` |
| `error.breadcrumbs` | **stringified** JSON array, **`app.crash` only** |

⚠ **`error.source` is a re-cut of `crash.cause`, not a rename** — do not map the old values on
positionally. `cross_origin` is new and names an instrumentation gap: `window.onerror` receives
`error === undefined` for a bundle served from a CDN without CORS headers, the classic
`"Script error."` with no stack. **`ConsoleWarn` is deleted** — a warning becomes a breadcrumb.

⚠ **`error.fatal` is a trap.** On web nothing is fatal — `window.onerror` fires and the page keeps
running — so a cross-platform `1 − COUNT(fatal=true)/sessions` scores **web at 100% forever**. Any
cross-platform crash-free chart must exclude web, or use the unfiltered `COUNT(app.crash)`.

**`error.handled` does not exist** — the event name carries that bit, and carrying both is a
denormalization that can disagree. **No fingerprint on the wire**: grouping is processor-side,
because algorithms always change and that is a backfill server-side but an app-store rollout
SDK-side.

**Breadcrumbs are stringified** because `stringAttr` renders a real array through `fmt.Sprint` as Go
map syntax, not JSON. They ride `app.crash` **only**: `app.error` volume is consumer-controlled, and
a 1–2 KB blob on a high-volume event is how the transport budget gets spent by the SDK's own doing.

**`captureError(error: unknown, context?)`** takes `unknown` on purpose — half of real `catch`
blocks receive a string or an axios rejection object, and a consumer should not have to prove to
TypeScript that it is an `Error` first. The caller's `context` is spread **under** the SDK's
`error.*` keys, so it can annotate but not forge. It is Tier 2, so ⚠ **"% of errors attributed to an
action" is bounded well below 100% by design**: a `captureError()` from a background retry has no
live root and correctly carries no trace keys at all.

**`captureConsole` defaults off.** React's own dev-mode `console.warn` output was the dominant
contributor to v3's crash count, which is what made "is my app crashing more this release?"
unanswerable. Opted in, `console.error` becomes `app.error` and `console.warn` a breadcrumb.

### Symbolication — `app.build_id` and the stack payload

`adapters/crashCapture.ts` + `collectContext()` (§4.8, #101). The wire half only: the source-map
build plugin and the resolve pipeline are backend/tooling work and explicitly out of scope.

**`error.stacktrace` travels raw and byte-for-byte** — no normalization, no reformatting, no path
rewriting, because `metro-symbolicate` consumes the engine's native format and any normalization
breaks it. Structured `error.frames` was rejected on the record: the SDK would parse **three**
formats (V8 `at fn (url:1:2)`, JSC `fn@url:1:2`, Hermes `at fn (address at bundle:1:2)`) and every
parser bug becomes an app-store rollout.

**The resolve key is `(app_id, device.platform, app.build_id)` — three parts.** A git SHA is
identical for the iOS and Android builds of one commit while Metro's output is not, so a
single-part key resolves an Android crash against the iOS map and produces frames that are
**plausible and wrong**. `device.platform` is already on Context, so the second part is free.

**`app.build_id` is consumer-supplied** — `createTelemetry({ buildId })`, constructor-only —
**omitted when unset, never `""`**, and ⚠ **never derived from `app.version` + `app.build_number`,
under any circumstances**. That fallback is correct for the majority, which is exactly what makes
it dangerous: under Expo Updates or CodePush the native binary is unchanged, so it fetches the
**wrong** map and resolves to plausible-wrong lines with nothing on the row marking them
untrustworthy. **Absence is itself the signal.** The SDK has zero OTA awareness — no
`expo-updates` or `code-push` dependency, peer or optional — so it cannot derive one honestly.

It is assembled **with the identity keys**, after caller `data`, so a stray `log()` payload cannot
shift which map a crash resolves against. Being `app.*` it is **already Tier A immutable** in
`beforeSend` — the join key cannot be scrubbed away. `error.stacktrace` stays **Tier C**: a
consumer with genuine PII in frames must be able to drop it, and that forfeit is theirs.

⚠ **The SDK never assigns `Error.stackTraceLimit`.** RN sets it nowhere, so V8's default of **10
frames** governs — not the 2000-char cap, which holds ~26 — and ten frames of an
`unhandledrejection` can be entirely library internals. Raising it globally would be an invisible
mutation of the consumer's runtime, making every `new Error()` in their app more expensive and
unattributable to us. So `adviseStackTraceLimit()` says it **once per process, in dev only**, and
the consumer writes the line. It fires from `buildErrorAttributes()` — the one chokepoint every
captured stack passes through — rather than at init, so #23's *"construct → log → flush is silent
by default"* still holds, and it is deliberately **not** behind the `debug()` gate: a consumer who
has not wired this up is exactly the consumer who has not set `debug: true`.

`view.error_count` and `sdk.error_count` count **both** names — a closed enumeration, not failed
requests and not `console.warn`. Only `app.crash` gets the dedicated crash path (persist + one
batch) and the eviction reprieve.

### Metrics — `metric.unit` and the frame window

`core/telemetry.ts`'s `METRIC_UNIT` map + `adapters/frameAggregate.ts` + `adapters/frameTracker.ts`
(§5.1, #104). Metrics are Tier 3 — **trace-free, all of them**.

**`metric.unit` ships on every metric whose name has one**: `ms` for `frame_render_time` and the four
timing vitals, `MB` for `memory_usage`, **`score` for `CLS`**. Without the CLS entry every chart that
does not special-case `metric_name` renders a CLS of `0.08` as a flat zero line beside an LCP of
`4000` in the same `value` column. It is stamped **after** caller `data`, so a stray attribute cannot
mislabel the unit of the column the row lands in, and it is **omitted** for a name not in the map —
a consumer's own `recordMetric()` name has no unit the SDK can honestly claim.

**`frame.target_fps` is measured, not assumed** — and `frame.target_hz` is gone. rAF cannot fire
faster than the display, so the floor of the window's deltas *is* the refresh interval; no new
platform API is involved. ⚠ The floor is the **5th percentile, not the minimum**: one spurious
short delta would snap a 60 Hz device to 120 and double its `frame.dropped_count`, reintroducing
the very defect the key exists to fix, while a real 120 Hz display produces short deltas by the
hundred. It then snaps to §5.1's `{60, 90, 120}`, which absorbs what jitter is left. ⚠ **`frame.dropped_count` budgets against the measured rate**, so its values move on
every 90/120 Hz device — v3's hardcoded 60 was simply wrong there, and this is a correction with a
chart discontinuity, not a regression.

**The window closes at 10 s *or* at a view boundary, whichever comes first**, which is what puts a
route change's dropped frames on the screen that was **leaving**. The seam is
`ViewManager.onBoundary()`: subscribers are **awaited inside `beginView`, before the successor
replaces the current view**, so the metric's Context block resolves to the departing `view.id`.
⚠ That ordering *is* the feature — fire it after the mint and the fix inverts into the bug.
⚠ **It does not fire on the `session_rotation` boundary.** `newSession()` installs the new
`session.id` before minting the successor, so a row emitted there would carry the new `session.id`
with the departing `view.id` — exactly what §4.5's "`view.id` never spans a `session.id`" bars.
Emitting *before* the rotation is worse: `logMetric` re-checks expiry, `lastActivity` is still
stale, and the emit would rotate the session a second time. A throwing subscriber is **swallowed**
— a broken frame window must not be able to abort view minting.
Variable-length windows are why **`frame.window_duration_ms` always ships**: a p95 over an unknown
sample count is uncomparable. An empty window emits nothing but still resets the clock, so the key
always describes the samples it carries. Accepted cost: a fast route change emits a p95 over a thin
sample.

The rAF loop is **one shared `FrameDropTracker`**, not a `.web`/`.native` pair — rAF and
`performance.now()` are globals both runtimes provide, so there was nothing platform-specific left to
split and the two builds cannot drift on window length, measurement or the reset.

### `memory_usage` — RSS, native only, and a sampler that runs

`adapters/native/memoryNative.native.ts` (§5.2, #105). There is **no web counterpart** — the file was
deleted, not stubbed, and `TelemetryWeb` has no `trackMemoryUsage` method at all. `performance.memory`
is Chromium-only, so the metric's *presence* was a browser-detection signal wearing a memory label,
and a p95 over it was Chrome-only data with no population marker on the row to say so.

**The sampler actually runs.** v3's `trackMemoryUsage()` fired the one-shot read and then applied
`.catch` to its `void` return — so the one call it did make threw, and the periodic `start(30000)` had
no caller. The metric was single-shot at best and zero-shot in practice. `MemoryHandler` is now
`{ start(): Promise<void> }`, the same shape as every other tracker interface, so core's uniform
`void h.start().catch(...)` registration is correct by construction rather than by coincidence.
`start()` is **idempotent** — a second call returns rather than opening a second interval.

**`memory.type` is `rss`**, read from the device-info package's `getUsedMemory()`. `performance.memory`
sees the **JS heap only**, while RN's memory lives largely in native allocations — images, native
views — which are what actually get the process OOM-killed. RSS is also engine- and
architecture-independent, so a Hermes and a JSC build report the same quantity.

| Key | Rule |
|---|---|
| `value` | resident MB — `metric.unit` is `MB` |
| `memory.type` | const `"rss"` ⚠ was `"heap"` in v3, on the same column |
| `memory.total_mb` | device total MB; **omitted when only the total read fails** — the two device-info reads are guarded separately so a failing total cannot cost the resident figure §5.2 makes primary |
| `memory.source` | `Platform.OS` |

**`usage_mb`, `pressure_level` and `memory.unit` are gone** — the first duplicated `value`, the second
has been discarded on arrival for every RN sample ever sent, and the third is superseded by
`metric.unit`. ⚠ **A read that throws or returns a non-finite number emits nothing** rather than a
fabricated `0`, which would drag every percentile down and read as a memory *win*.

⚠ **This is the one tracker `shutdown()` tears down**, via an optional `stop()` on `MemoryHandler`.
It owns a `setInterval`; the rAF-driven `FrameDropTracker` does not, and a leaked 30-second timer
calling `logMetric` on a shut-down instance is not the same residue as a rAF loop the platform
already parks on background.

### Core Web Vitals — web only, on the metric path

`adapters/webVitals.ts` (the pure half) + `adapters/web/webVitals.web.ts` (the subscription),
§5.3, #106. Five names — `LCP`, `FCP`, `CLS`, `INP`, `TTFB` — all already on `ALLOWED_NAMES`.

**They ride the metric path, and the decider was not taxonomy.** An *event* named `LCP` lands its
name in the performance-events table and **loses its number**: `extractPerformanceEvent` promotes
only the memory and frame columns. The metric path promotes `value` and `metric.unit` for free,
indexed by `metric_name`.

**Source is `web-vitals/attribution`, a bundled web-only dependency.** Hand-rolling was rejected on
session-windowed CLS (the naive sum is wrong *and plausible*) and percentile INP. It is imported
from **exactly one file** — `adapters/web/webVitals.web.ts` — which is what keeps it out of
`index.native` entirely; `vite.config.ts` externalizes an **explicit allowlist**, so a bundled
dependency stays bundled and **consumers install nothing**. Both halves are asserted against the
**built output** in `src/vitals.native.test.ts`, by walking the chunk graph rollup emitted.

**Four shared keys**, on every vital row:

| Key | Rule |
|---|---|
| `vital.rating` | never absent — `good` \| `needs-improvement` \| `poor` |
| `vital.navigation_type` | never absent — 6 values, ⚠ **load-bearing**: a `back-forward-cache` LCP is ~0 ms and silently drags a p75 down if the population is not separable |
| `vital.target` | LCP's `target` / CLS's `largestShiftTarget` / INP's `interactionTarget`; **absent on FCP and TTFB** |
| `vital.load_state` | **absent on LCP and TTFB** — neither has one |

**Ten per-vital keys.** LCP: `lcp.time_to_first_byte`, `lcp.resource_load_delay`,
`lcp.resource_load_duration`, `lcp.element_render_delay`, `lcp.url` (query-stripped).
INP: `inp.input_delay`, `inp.processing_duration`, `inp.presentation_delay`,
`inp.interaction_type`. CLS: `cls.largest_shift_value`. TTFB and FCP carry none.

⚠ **LCP's four phases sum exactly to `value`** — a testable claim, asserted on the wire, not a
description. `lcp.time_to_first_byte` deliberately duplicates the `TTFB` row rather than forcing a
cross-row join to decompose one number.

⚠ **`vital.target` is a raw CSS selector, bag-only, never promoted, and the least sanitized key on
the wire** — which is *the* reason `beforeSend` covers metrics (§3.6). §4.6's action-name ladder was
rejected for it on the record: the role gate blanks `<img>`, `<h1>` and banners, which is most vital
targets, and un-gating the ladder would rebuild the `textContent` hole the gate closes. A selector
is developer-authored structure — tags, ids, classes — never user content.

**CLS and INP subscribe with `reportAllChanges: true` as a running-value *subscription, not an
emission trigger*.** The latest value is held in memory and shipped at the `ViewManager`'s
**background boundary** — the library's default page-hide report races the document's teardown and
loses both on a closed tab. LCP, FCP and TTFB fire once on the initial load and emit straight from
the callback.

**The boundary seam is `ViewManager.onBoundary()`, which now hands the subscriber the successor's
load type.** `frame_render_time` wants every boundary; vitals want **`"resume"` — background —
only.** Emitting a page-load-scoped vital at a soft navigation would ship a second row for the same
page load and stamp it with a `view.id` that is not the initial view's. A held value that has not
moved since its last row is skipped, so a tab hidden twice with no shifts in between is one CLS
sample, not two — the same no-delta-no-report property the library's own reporter has.

⚠ **All five are page-load-scoped, not view-scoped, and that is documented rather than engineered
around.** `LCP`, `FCP` and `TTFB` physically **cannot recur on a soft navigation**. So **`view.id`
on a vital row is always the *initial* view's** — a real join key, just not "the view this happened
in" for CLS and INP. `GROUP BY view.name` over vitals reads **"by entry point"**, which is a
genuinely useful dashboard only if you name it that way. View-scoping would need the Chrome-only
Soft Navigations API, or a per-view INP reset producing "slowest interaction in this view" wearing
INP's name.

**Vitals are Tier 3 — trace-free**, like every other metric (§6.3), and `metric.unit` ships on all
five: `ms` for four, **`score` for CLS**.

**`TelemetryNative` emits none, ever**, and exposes no method to. Native's load-performance
analogue is `app.start` (§4.3).

### `user.profile.update` — the one event that carries the PII

`core/userProfile.ts` (§4.10, #107). `user.name` / `user.email` / `user.phone` /
`user.custom.*` appear on **`user.profile.update` and on no other event**. They were on the
Context block of every row, so a 10,000-event session put 10,000 copies of an email address on
the wire and at rest to populate a per-user upsert table that needs it **once**. Copies per
session go N → 1, and it is self-healing: the profile is in-memory, so `identify()` re-fires
every launch.

`user.id` stays on the Context block — it is the join key, not the payload, and it is **present
on this event by construction** because `identify()` gained an optional `userId`. The one call
that sends a profile should set the key that profile attaches to; a profile with no `user.id`
has nothing to upsert on under §3.2's consumer-supplied identity. Omitting it leaves `user.id`
exactly as it was — ⚠ **`identify()` still never mints one.**

| Key | Cap | Rule |
|---|---|---|
| `user.name` | 255 | from `fullName`; omitted when empty |
| `user.email` | 255 | |
| `user.phone` | **50** | `rum_users.phone` is `VARCHAR(50)`; the mismatch loses the whole profile behind a 2xx |
| `user.custom.*` | ≤**64 keys**, key ≤64 chars, value ≤255 | consumer keys pass through **verbatim, casing included** — the SDK imposes no normalization here |
| `user.custom_dropped` | — | int, **omitted until there is a drop** |

**One bag rule retires three defects at once.** A non-primitive value is `JSON.stringify`'d and
then truncated; a value that cannot be stringified is **dropped**. That closes `flattenWithPrefix`'s
missing depth guard — a cyclic `customAttributes` value recursed to a **`RangeError` inside the
SDK**, crashing the host app's render tree on a bad `identify()` — raw arrays violating the
primitive-values rule, and nested objects recursing into the bag.

⚠ **Truncation is not a drop; a key-length overflow is.** A >255-char value ships truncated and
books nothing. A >64-char key is **dropped**, because truncating it would be the normalization
§4.10 forbids, and two long keys sharing a prefix would silently collide. Key-count overflow past
64 is dropped in iteration order.

**Overflow is dropped, counted and warned — never a throw.** The warning is `isDev()`-gated and
said **once per process**: it is the third of the Conventions' three console carve-outs, and it
exists for the same reason as the other two — a consumer with a bad `identify()` payload is
exactly the consumer who has not set `debug: true`.

**`flattenWithPrefix` also gained a depth cap of 8**, so the *general* `log(name, data)` path
cannot blow the stack either. Nothing on this wire nests past `deviceInfo`'s two levels, so 8 is
unreachable for a real payload and a cycle stops there.

⚠ **An array on the caller-`data` path now ships as a JSON string, and the depth cap alone was
not enough.** The flattener never recursed into arrays, so a cycle reached *through* one —
`log("x", { wrapped: [{ inner: cyclic }] })` — never met the depth counter at all. Passed
through raw it threw in the sender's `JSON.stringify`, where `flush()`'s catch **swallowed it
and lost the whole batch, silently, with no counter and no log**. Arrays and depth-capped
objects therefore take the same `stringifyOrDrop` path the bag does. That also settles the
primitive-values rule on this path: the collector renders a raw array through `fmt.Sprint` as Go
map syntax anyway, so JSON is strictly the better of the two shapes.

**Six public profile fields are `@deprecated` but live**, for removal in v5 — `fullName`,
`firstName`, `lastName`, `avatar`, `createdAt`, `updatedAt`. Their wire keys are gone outright
(§3.4): `user.fullName` duplicated `user.name`; `firstName`/`lastName`/`avatar` had no column and
no reader anywhere, and `identify()` could never set the first two; `createdAt`/`updatedAt` were
byte-identical every session for any one-`identify()` app, since the profile is in-memory only.
`fullName` stays functional — it is still what `user.name` is built from.

⚠ **`identify()` merges only what the call supplied.** `setUserProfile` merges by spread, so
passing `email: undefined` through would wipe an email a prior `setUserContact()` set. The event
is built from the **live profile**, not from the call's arguments, so a preceding
`setUserName()` / `setUserContact()` ships on it.

### The Store port

Persisted state goes through `Store` (`core/store.ts`), a shared-core `get` / `set` / `remove`
interface with **no React Native import** — v4 moved `device.id` and session resume into shared
core, the sticky sample decision rides in the session record, and the capped offline store
follows — none of which can reach
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

### Caps, `event.sequence` and the crash path

Both queues are capped, **drop-oldest, `app.crash` evicted last** (§9.4). The in-memory queue
holds 500; the offline store holds 500 events / 1 MB. `evictIndex()` in `core/telemetry.ts` is
shared by both, so the memory queue and the disk queue can never disagree about what survives.
Evicting crashes first would make the crash-free rate read *better* the worse the network is —
that is the whole reason the rule exists. When every row is a crash the oldest crash goes
anyway; growing past the cap is not the other option.

**`event.sequence`** is stamped in `enqueue()`, **after** `beforeSend` — a hook-dropped row must
not consume an ordinal, or every scrub would read as real loss to the backend's gap detection.
It is persisted with the session record for the same reason `session.sequence` is: a resume that
restarts at 0 forges duplicate `(session.id, event.sequence)` pairs, which is the exact key the
dedup index is built on.

**On `app.crash`** the queue is persisted and **one** batch is sent, crashes reordered to the
front. Not a drain — a dying process gets one round trip. The queue is *left intact*, because
an `app.crash` is not always fatal — `window.onerror` fires and the page keeps running — and the
process usually lives on; a successful send therefore leaves *one*
duplicate on disk, and `event.sequence` is what makes that free.

*One*, because the persist is watermarked on `event.sequence` (`crashPersistedThrough`): a
crash-heavy session flushes often, and re-persisting the whole queue each time would fill the store
with copies of its own backlog and book `store_full` drops that are not loss. The batch is
spliced out **before** the send, not after — both the interval and the batch-full trigger fire
`flush()` unawaited, so a post-send splice could delete rows the batch never carried.

⚠ **The web/native asymmetry here is real and is not fixed.** Web's `Store` is synchronous
`localStorage`, so the persist has landed when the next line runs and the loss window *closes*.
Native's is an AsyncStorage round-trip a SIGKILL can outrun, so it only *narrows*. Awaiting
harder does not change that.

### `beforeSend` and `sessionSampleRate`

Both are **constructor-only**, in shared core, on both builds (§3.6). There is deliberately no
runtime setter: registering one later leaves a window between init and registration where
`session.started`, the launch root and the earliest `http.request`s have already been enqueued.

**`beforeSend(event) => event | null`** runs **synchronously, at enqueue**, over events *and*
metrics. At enqueue because a failed send persists the batch through the `Store`, so a
flush-time hook would let unscrubbed PII hit disk — and on native that disk outlives the
process. Synchronously because `app.crash` flushes during teardown, and a Promise-returning
hook would put a host `await` in a dying app's path. Metrics are included because `vital.target`
is a raw CSS selector, the least sanitised key on the wire.

Three tiers, in `core/beforeSend.ts`, **enforced by re-stamping after the hook returns, never by
throwing** — the realistic hook is `delete attrs[k]` in a loop and the realistic failure is
over-deletion, so an over-broad hook must not be able to get a consumer's whole feed silently
discarded behind a 2xx:

| Tier | Keys | Rule |
|---|---|---|
| **A — immutable** | `type`, `eventName`/`metricName`, `timestamp`, `session.id`, `session.start_time`, `session.sequence`, `event.sequence`, all `sdk.*`, all `app.*`, `device.platform`, `trace.id`, `span.id`, `parent.span.id`, `rum.action.id`, `view.id` | replaced wholesale from the original — covers deletion *and* forgery. ⚠ `trace.root_type`, `span.start_time` and `span.duration_ms` are **not** on §3.6's list and are Tier C |
| **B — rewritable, not deletable** | `device.id` | a hashed id is legitimate; a missing one 400s the whole batch at the collector |
| **C — free** | everything else — `user.*`, `http.*`, `error.*`, `ui.target`, `vital.target`, `user.custom.*`, caller `data` | untouched; this is where the PII lives |

The hook is handed a **copy**, never the queued object: re-stamping from an object the hook has
already mutated in place would restore nothing and make the tier table decorative.

A hook that **throws fails closed** — the event is dropped, never sent in its original form,
because a bug in a scrubber must not ship the exact field the scrubber existed to remove.
Only an explicit `null` counts as a deliberate drop; a hook that hands back anything else that
isn't an event (a forgotten `return`, a string) is a bug and books as *failed*. The two outcomes
are counted **separately** on the Context block — `sdk.hook_failed` (broken) and `sdk.hook_dropped` (working) — because "my volume
is down 40%" has to distinguish them and one merged counter answers neither.

**`sessionSampleRate` is sticky per session**: rolled once, re-rolled at each rotation, and
persisted with the session record (`sampled` + `sampleRate`), so a resume adopts the decision
rather than re-rolling into a half-sampled session. Never per-event — that would desynchronise
the per-view counters. A rotation re-rolls at the *configured* rate, not the retired session's.

A **sampled-out session sends nothing at all**: no skeleton record, and **crashes are not
exempt** — 100% of crashes over 10% of sessions makes the unfiltered crash-free query read 10×
too high with no `WHERE` available to repair it. The boundary checks still run while sampled
out, so the rotation that re-rolls the decision happens on schedule. `session.sample_rate` ships
on every row instead, so extrapolation is arithmetic. An out-of-range or non-finite rate warns
and falls back to 1: `Math.random() < NaN` is always false and would silently mute a deployment.
The same range check runs on a **resumed** record — a rate we can't trust loses its stuck
decision too, and the fresh roll stands, rather than shipping a bad divisor on every row.

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

The session record — `{id, start, lastActivity, sequence, eventCount, errorCount, sampled,
sampleRate}` — is written
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

On web a `pageshow` with `persisted: true` re-runs the same decision, because a bfcache freeze
can outlast the idle window and a sibling tab may have rotated the shared record meanwhile. That
re-entry is idempotent: when storage has nothing to say it keeps the live session rather than
re-announcing one that never ended.

Metrics are samples, not user actions: they never refresh `lastActivity`, but they *are* checked
against both boundaries — otherwise a backgrounded app sampling memory would ship forever under a
session that expired hours ago, which is the exact thing the 4-hour cap exists to stop.

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
| `http.request` | XHR only on native (fetch *is* XHR there); fetch + XHR on web |
| `app.crash` | JS error or unhandled rejection — **unhandled only**, no public path (§4.7) |
| `app.error` | `captureError()`, an opted-in `console.error`, and a re-routed public `log("app.crash")` |
| `ui.interaction` | every web click, actionable or not; every native `trackTap(name)` (§4.6) |
| `view` | each of the four view exit boundaries (§4.5) |
| `app.start` | once per process at init — the `launch` root, and §4.3's launch compensator |
| `network_change` | connectivity type transition |
| `user.profile.update` | `identify()` |
| `custom_event` | any non-allowlisted `log()` name |
| `frame_render_time` | **metric** — p95 per window; the window closes at 10s **or at a view boundary** (§5.1) |
| `memory_usage` | **metric** — resident MB, **native only**, sampled every 30 s (§5.2) |
| `LCP` `FCP` `TTFB` | **metric** — **web only**, once on the initial load (§5.3) |
| `CLS` `INP` | **metric** — **web only**, running values drained at the background boundary (§5.3) |

Allowlisted but with **no producer**: `page_load`, `resource_timing`, `long_task`. The
remainder of the RN-Web track, not built yet.

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
  `core/debug.ts`, off unless `debug: true`. **One carve-out, and it is closed**: a diagnostic
  reporting *the consumer's own mistake* — a malformed config, an unset runtime knob, a payload
  the SDK had to drop — may write directly, provided it is gated on `isDev()` from the same file
  and said **once per process**. §6.4's malformed-allowlist report, §4.8's
  `Error.stackTraceLimit` advisory and §4.10's `user.custom.*` overflow warning are the only
  three, because `debug: true` is exactly what a consumer with a mistake has not set. ⚠ The
  third one fires from `identify()` — a path a shipped app takes — which the earlier
  *config-wiring-only* wording did not cover; `isDev()` is what keeps it off a shipped app's
  console, and that gate, not the call site, is the actual rule. Anything that can fire more
  than once per process goes through `debug()`.
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

Real and current, maintained by hand as behaviour changes. Flag before "fixing" — several
need backend coordination, and several are deliberate trade-offs with the reasoning recorded
above rather than defects.

- **The profile-setting methods no longer reach the wire on their own.** `setUserProfile`,
  `setUserDetails`, `updateUserProfile`, `setUserName` and `setUserContact` record state; only
  `identify()` emits `user.profile.update`. A consumer who used `setUserProfile()` and never
  called `identify()` shipped PII on every event in v3 and ships none now. That is §4.10's
  point, but it is a behaviour change those consumers will read as data loss — they need one
  `identify()` call.
- **`user.custom_dropped` counts keys, not causes.** A cyclic value, an over-long key and the
  65th key all book `1` with nothing on the row telling them apart. The dev warning names the
  bounds; splitting the counter three ways would spend three columns on a debugging aid.
- **The `user.custom.*` overflow warning is the third console carve-out** — dev-only, once per
  process, outside the `debug()` gate, for the same reason as the other two.
- **Arrays on the caller-`data` path changed shape**: `log("x", { tags: ["a","b"] })` shipped a
  raw array in v3 and ships `'["a","b"]'` now. The collector `fmt.Sprint`s a raw array into Go
  map syntax, so this is a better wire shape, but it *is* a value change on an existing key for
  any consumer already passing arrays. Not what #107 asked for — it is the only way to close the
  silent batch loss a cycle inside an array caused.
- **`flattenWithPrefix`'s depth cap stringifies at depth 8 and is uncapped in length**, unlike
  `user.custom.*`'s 255. The general `log()` path has never had a length cap and the collector
  truncates at 10,000 runes, so adding one here would be a new rule for an unreachable case —
  nothing on this wire nests past `deviceInfo`'s two levels.
- **`identify({ userId: "" })` ships the profile unkeyed.** It routes through `setUserId`, which
  clears on `""` (§3.2) rather than shipping an empty string, so the profile event carries no
  `user.id` at all — the same outcome as omitting `userId`, and the same hazard as the bullet
  below. Consistent with `setUserId` by design; flag it if §4.10 wants a rejection instead.
- **`identify()` still never mints a `user.id`.** `identify({ userId })` sets one, but an
  `identify()` without it leaves anonymous traffic anonymous — so a profile can land with no
  `user.id` to upsert on. §4.10 calls the key "always present on this event by construction";
  that construction is the consumer passing `userId`, and the SDK will not invent one (§3.2).
- **`memory_usage` is RSS, so it is not comparable to a v3 chart across the cutover.** v3
  reported the JS heap under the same `memory_usage` name; a panel spanning the change
  compares two different quantities. `memory.type` (`heap` → `rss`) is what tells them apart.
- **`memory.total_mb` is the *device* total, not a per-process limit**, so `value / total_mb`
  is share-of-device, not share-of-budget. iOS kills an app well below the device total.
- **A device-info read that throws emits nothing**, so a sampler failing on every tick is
  indistinguishable from a build that never started one. There is no counter for it.
- Web navigation paths keep their query strings, so tokens and PII in query params ship as-is.
  (`http.request` itself carries no URL — see the `http.request` section.)
- `flush()` sends **one** batch per call — it does not loop. At 50/30 s a large backlog still
  drains a batch per interval; the draining `flush()` is contract §12.5 and a separate change.
- `sdk.drop_reason` has no `rejected` producer: 4xx-drops-the-batch is #113.
- A re-persist inside `replayFailed()` can evict without booking it — the sender has no core
  instance in reach. §3.7 already calls these counters lossy about their own loss.
- **`error.*` keys are Tier C** in `beforeSend` — not on §3.6's Tier A list, so a hook may delete
  or rewrite them. Deliberate: this is where the PII lives.
- The 2000-char `error.stacktrace` cap is a **tuning knob, not a contractual constant**, and may be
  tight for Hermes. The cut lands on a frame boundary because a mid-frame cut resolves to a
  *different, wrong* location rather than failing.
- **`app.build_id` needs a backend column before it is useful** — it ships on the Context block
  today, but a join key sitting in an attribute bag nothing queries is inert (§4.8's work-list
  item 7). Symbolication itself is greenfield backend-side.
- **The `Error.stackTraceLimit` advisory writes to the console outside the `debug()` gate** —
  dev-only, once per process, and from the stack-capture chokepoint so #23's "construct → log →
  flush is silent by default" still holds. It is the second of the two carve-outs the
  Conventions bullet names, not an exception to it.
- **`ui.interaction` needs backend allowlist sign-off before it ships** — it is already in
  `ALLOWED_NAMES`, so it is being emitted, and an unlisted name is dropped on ingest.
  `user.interaction` came off the list in the same change.
- **Native interaction coverage equals native instrumentation coverage.** `trackTap(name)` is the
  only producer, so `view.action_count` counts *named taps*, not taps; an uninstrumented screen is
  indistinguishable from an unused one. Same reason `ui.rage` is gated to `edge_action`.
- **`trackTap` ships `ui.tag: "native"` and `ui.x`/`ui.y` of `0`.** All three are never-null in
  §4.6 and native has no element and no coordinate; a `PressEvent` carries coordinates but
  `trackTap(name)` deliberately takes none. Flag it if the backend wants the tag column empty
  instead of a constant.
- **Native rage keys on the name, so two different buttons sharing one `trackTap` name are
  one burst.** There is no node to key on — the name *is* the element — and the collision
  over-reports where web's node identity cannot. Name taps per control.
- **A tap arriving before `instancePromise` settles loses the mint/emit split** — there is no core
  to snapshot from, so it reports emit-time identity. That window is the launch view either way,
  which is why it is not worth a queue.
- **`ui.dead`'s navigation signal fires on the background and session-rotation boundaries too** —
  neither is a navigation the click caused, so those clicks report *alive*. Under-reporting is the
  direction §4.6 requires; the alternative is a false accusation.
- **`ui.dead` is omitted, not false, where there is no `MutationObserver`.** The row still ships
  with every other key — absence means "not evaluated", exactly as it does for the exempt cases.
- **§4.6's key table caps `ui.target` at 64 while its prose exempts rung 1.** The issue's
  acceptance criteria say `data-edge-action-name` ships "unnormalized and uncapped", so that is
  what ships — and native's `trackTap(name)` is rung 1's equivalent, so **every** native
  `ui.target` is uncapped, not just the annotated web minority. Flag it if the backend column is
  a hard 64.
- **A hard navigation drains open dead-click windows, but `log()` is still async.** `pagehide`
  and `visibilitychange: hidden` emit every pending row with `ui.dead` **omitted** — the window
  never closed, so it was not evaluated. The enqueue itself is a promise, so a document that
  unloads inside that microtask still loses the row; the same residue the crash path documents,
  and awaiting harder does not change it.
- **`ui.x` / `ui.y` are `0` on a synthetic or keyboard-driven click**, where `clientX`/`clientY`
  are absent. §4.6 types both as never-null, so there is no honest way to omit them; a keyboard
  activation is genuinely at no viewport coordinate.
- **`app.error` needs backend allowlist sign-off before it ships** — it is already in
  `ALLOWED_NAMES`, so it is being emitted, and an unlisted name is dropped on ingest.
- Crash capture is still JS-level, so **`error.fatal: true` means "`ErrorUtils` called it fatal"**,
  not "the process died".
- **`sdk.error_count` counts both names.** §4.2 types it only as `int`; §4.5 defines
  `view.error_count` as `app.crash + app.error` and the two are kept in step. Flag it if the
  backend wants `sdk.error_count` to stay a pure crash count.
- **The frame-boundary truncation degrades when there is no boundary** — a single frame longer
  than 2000 chars has no newline inside the budget, so that one cut lands mid-frame. The
  `\n… [truncated]` marker is what makes the case countable.
- No top-level `location` in the envelope, though the contract allows one.
- `apiKey` is only validated in the factory; the `TelemetryWeb`/`TelemetryNative`
  constructors still accept it as optional.
- **`session.reason: "launch"` undercounts launches.** A resume emits no `session.started` at
  all, so the rows that would reveal it are the ones never emitted. §4.3's `app.start` is the
  compensator and is not built — count launches from `app.start`, not from `session.reason`.
- Session state is read at init and on a web bfcache restore, **not live-synced**. Two tabs
  open at once share the `localStorage` record but keep their own in-memory `lastActivity`, so
  they can diverge and both finalize the same `session.id`. A `storage`-event listener would
  close it.
- A `Store` reporting `unavailable` means the session can't be resumed, so every launch mints
  one. There is no `session.id_ephemeral` to mark that population — but the same store failed
  the `device.id` round-trip, so those events already carry `device.id_ephemeral: true`.
- Crash capture is JS-level only — no native signal/ANR/hang capture.
- `index.base.ts` `trackErrors()` imports the **native** crash handler in shared code; the
  web build resolves it at runtime and rejects.
- **`view` needs backend allowlist sign-off before it ships** — an unlisted `eventName` is
  dropped on ingest. It is already in the SDK's `ALLOWED_NAMES`, so it is being emitted.
- Settle sees only what the SDK intercepts — JS `fetch`/XHR. `rn-fetch-blob`, RN Firebase, native
  Apollo links, `expo-file-system`, `Image` loading and `WebSocket` are outside the chokepoint, so a
  view whose real wait is one of those reports `no_activity`. Same boundary as `http.request`.
- Native `initial_load` is systematically **smaller** than web's — web includes DNS, TLS and
  document download; native reads a bundle off local disk. **Cross-platform `initial_load`
  comparison is not apples-to-apples.** Within-platform release comparison is untouched.
- §4.5's table says `view.loading_time`'s null has **four** causes, but its outcome domain has
  only three null-bearing values. The fourth is unidentified; the SDK produces three. Needs a
  contract ruling, not a locally invented fourth.
- **`view.loading_time` is omitted when null, not sent as an explicit `null`.** §4.5's table says
  "Null? **yes**" while §4.11 calls `navigation.from_screen` "the SDK's only explicit wire null" —
  the two readings conflict. Omission is what every other optional key on this wire does, so that
  is what ships; changing it is a wire change and needs backend sign-off.
- `view.loading_time`'s clock starts at the route change, **not at the tap**. Tap-to-route-change
  latency runs a handler in the *old* view and belongs to the action envelope (§6.6), which is not
  built. A prefetched screen therefore reports `no_activity` — exact as "started no fetches of its
  own", wrong if read as "does not fetch".
- **`frame.target_fps` is snapped to {60, 90, 120}** (§5.1's domain), so a 144 Hz panel reports
  120 and budgets its dropped frames at 8.3 ms rather than 6.9 ms. The key exists for the budget,
  not for a display census. Flag it if the backend wants the measured rate raw.
- **`frame.dropped_count`'s values moved** with the measurement: on a 90/120 Hz device v3 budgeted
  against a hardcoded 60 and undercounted. A correction, not a regression — but it is a chart
  discontinuity at the cutover.
- **A fast route change emits a p95 over a thin sample.** That is the accepted cost of the
  boundary reset; `frame.window_duration_ms` is what makes those rows filterable.
- **The frame window does not reset at the `session_rotation` boundary**, so at most one window
  carries across a rotation — a session that ended by idleness or the 4-hour cap, whose last
  window is ≤10 s. Resetting there would either pair a new `session.id` with the departing
  `view.id` or rotate the session twice; both are worse than the residue.
- **Vitals are page-load-scoped, so `view.id` on a vital row is the *initial* view's.** For CLS
  and INP that is not the view the value accumulated in. `GROUP BY view.name` over vitals reads
  "by entry point" and must be named that way; anything grouping them by a non-entry view name
  returns empty. §5.3 rules this documented rather than engineered around.
- **A tab hidden, restored and hidden again ships a second CLS/INP row** whenever the running
  value moved in between — the later row carries the larger cumulative value. One page load can
  therefore contribute more than one vital sample, and there is no page-load id on the row to
  collapse them by. Take the max per `(session.id, metric_name)` at the entry view, not an
  average. Emitting only at the first background instead would silently discard everything
  after the user's first tab-away.
- **A vital that arrives after the tab is already gone is lost.** `log()` is async and the
  background boundary's drain rides a promise, so a document that unloads inside that microtask
  loses the row — the same residue the crash path documents, and awaiting harder does not change
  it. The drain is still strictly better than the library's default page-hide report, which
  races teardown on *every* close rather than on the tail of one.
- **`vite.config.ts` is deliberately *not* extended for `web-vitals`, inverting #106's wording.**
  The issue asks for the externalization allowlist to be extended; externalizing is what would make
  every consumer install the package, and its own acceptance criterion is "consumers install no new
  dependency". Contract §5.3 calls it "a bundled web-only `dependency`", and the contract wins. The
  allowlist matters here by staying an *explicit* list — a bundled dependency stays bundled — and
  `src/vitals.native.test.ts` asserts the config does **not** name it. Flag it if that reading is
  wrong; the zero-bytes-to-native half is asserted against the built chunk graph either way.
- **`shutdown()` does not stop the vitals tracker.** Its `onBoundary` unsubscribe is discarded, so a
  view boundary after shutdown can still `logMetric`. Unlike `memory_usage` it owns no timer — the
  only thing that can fire it is a boundary, which needs a live app — so it did not earn the `stop()`
  hook §5.2 gave the memory sampler. The library's own observers are never detached either.
- **`vital.target` and `vital.load_state` are omitted when absent, not sent as explicit `null`s**,
  though §5.3's table types both `Null? yes`. This is the same omit-vs-explicit-null conflict
  already recorded for `view.loading_time`, and it is resolved the same way: omission is what every
  other optional key on this wire does. Changing it is a wire change and needs backend sign-off.
- **`src/vitals.native.test.ts` reads `dist/`**, so it is red after `npm run clean` until the next
  `npm run build`. Deliberate — §5.3's "zero extra bytes on native" is a claim about the *built*
  output, and a source-graph proxy would pass a bundler change that a chunk graph catches. `npm ci`
  runs `prepare`, so CI and any fresh install have `dist/` before `npm test`.
- **`vital.target` is Tier C in `beforeSend`** — a selector is developer-authored structure, but
  it is the least sanitized key on the wire and a consumer who disagrees can delete it. That
  forfeit is theirs.
- **The five vitals need backend allowlist sign-off before they ship** — all five are already in
  `ALLOWED_NAMES`, so they are being emitted, and an unlisted name is dropped on ingest.
  §5.3's fourteen attribution keys need columns or a bag that is actually queried.
- **`web-vitals` is a runtime `dependency` a native consumer also installs on disk** — bundled,
  so their app ships zero bytes of it, but `npm ls` shows it. Making it a devDependency would
  work today and break the moment anything externalizes it; the contract calls it a dependency.
- **`metric.unit` is omitted for a name the SDK has no unit for** — a consumer's own
  `recordMetric()` name ships no unit rather than a guessed one.
- The deprecated web `navigation` event still carries `location.pathname + search` raw, query
  string included. `http.request` and `view.name` are both clean; this feed is not.
- **`app.start` needs backend allowlist sign-off before it ships** — it is already in
  `ALLOWED_NAMES`, so it is being emitted, and an unlisted name is dropped on ingest.
- **`app.start.js_ready_ms` (§4.3) is not built.** #98 mints the event as §6.2's launch root;
  the payload key needs a ruling first. The marker is only known when the platform publishes
  it — on web that is the `load` event, which arrives *long after* `app.start` — so shipping
  it means either delaying `app.start` (and with it the launch root, which the initial view
  parents to) or shipping a key that is near-always absent on web. Neither is a local call.
- **An expired-record cold launch leaves the retired launch trace rootless.** The rotation
  re-mints the launch root so `trace.id` cannot span a `session.id`, which means the initial
  `view` row — emitted under the *old* session — is a child of a root whose row never ships.
  Same condition process death already produces; the alternative broke the invariant.
- **With an empty `traceHostAllowlist` (the default) no `traceparent.outcome` ships at all**,
  rather than stamping `skipped_off_allowlist` on every row of every consumer who never opted
  in. "Absent means not traced" is §6.5's own wording and a consumer with no allowlist is not
  traced; the rung stays reachable the moment an allowlist exists and a host is off it. A
  literal reading of the ladder would fire rung 1 — flag it if the backend wants the constant.
- **`skipped_consumer_set` is not final.** §0.3/§6.5 record a backend-owned open question:
  the live enum's `injected_inbound_malformed` says *inject over a malformed inbound header*,
  never-strip says *skip*. RN ships the skip. Population is 0 rows either way; the other six
  rungs are settled.
- A **direct `new TelemetryWeb()` / `new TelemetryNative()` skips the allowlist validation**,
  the same gap `apiKey` already has — both are only enforced in the factory.
- `traceparent.outcome` is **not** on §3.6's Tier A list, so `beforeSend` can delete or rewrite
  it (Tier C) — same status as `trace.root_type`, `span.start_time` and `span.duration_ms`.
- `trace.root_type = interaction` is minted by every web click (#102) and every native
  `trackTap(name)` (#103) — but on native only where the consumer called it, so an unattributed
  native request means *an uninstrumented tap*, not *no action*.
- An XHR `send()` that throws **synchronously** never reaches `loadend`, so a `request` root it
  minted lives out its 2 s window with no row describing it. Rare, and knowingly left.
- **A lower rung swallows its own boundary.** §4.5.1's "a lower rung arriving later does not
  overwrite a higher one" is implemented literally, so a host that calls `screenStart()` once and
  then relies on `attachNavigation` pins the view to that explicit name: route changes stop minting
  successors and dwell keeps accruing under the stale name. The rule exists because two rungs
  normally describe *one* navigation (the upgrade window), and §4.5 separately makes route change an
  unconditional boundary — the two readings conflict and it needs a contract ruling, not a local
  invention. Until then: call `screenStart()` per screen, or don't mix it with `attachNavigation`.

- **`device.cpu_abi` is the *first* supported ABI, not the list.** `supportedAbis()[0]` is the
  primary one — the answer to "is this a 32-bit device", which is what the key exists for — and a
  comma-joined list would be a high-cardinality string nothing groups by. Flag it if the backend
  wants the full list.
- **`device.cpu_abi` and `device.low_ram` are absent on web** (§3.3's `N`). A browser exposes
  neither, and `navigator.deviceMemory` is Chromium-only — the same browser-detection-wearing-a-
  memory-label defect §5.2 deleted `performance.memory` for.
- **The viewport keys are CSS/dp x pixel-ratio on both builds**, shaped once in
  `adapters/viewport.ts` so one column cannot come to mean physical pixels on one build and
  logical units on the other. They are comparable across web and native. ⚠ Web reads `window.innerWidth/innerHeight` — the
  *viewport*, not `screen.width` — so a desktop browser's value moves when the user resizes the
  window mid-session. That is the quantity CLS and LCP actually scale with.
- **`device.orientation` is derived from width vs height, not from `screen.orientation`.** A square
  window reports `portrait`. The two values it compares are the two the successor keys already
  ship, and it needs no feature check on either build.
- **An `undefined` attribute value is now dropped at the flattener** rather than riding the bag to
  be dropped by `JSON.stringify`. Wire-neutral — but a consumer passing
  `log("x", { "device.model": undefined })` used to blank the key and now leaves the real
  `device.model` in place, because the override never enters the bag.
- **`sdk.platform` falls back to the bare `"react-native"`** for a direct `new Telemetry()` with no
  entry-declared `platform`. That is the same gap `apiKey` and the allowlist already have: the
  factory is the only supported construction path.
- **The 39-key assertion is per-build, not per-row.** `context.web.test.ts` and
  `context.native.test.ts` pin a clean anonymous `custom_event`; a row with a `buildId`, a
  `user.id`, an ephemeral `device.id` or a drop booked carries more of the 39, which is what
  "omitted until there is one" means. No test asserts a row can carry **all** 39 at once — several
  are mutually exclusive by platform.
- **`ViewManager.nameOf()` keeps 16 retired names**, so a span outliving 16 view boundaries
  reports `view.name: "unknown"` against a live, correct `view.id`. Bounded on purpose — an
  unbounded map is a leak on a long session. ⚠ The bound is **not** justified by §4.5.2's 30 s
  cap: that one is `view.loading_time`'s, and an `http.request` has no cap at all, so a genuinely
  long request across 16 route changes does hit this. Rare enough to leave; the id still joins.
- **`device.cpu_abi` and `device.low_ram` can be omitted on native**, which §3.3 types never-null.
  They are read through `supportedAbis?.()` / `isLowRamDevice?.()` because
  `react-native-device-info` is an **optional** peer dep and an older one lacks both methods — and
  since #108 an `undefined` is omitted rather than shipped. Crashing a shipped app over a missing
  capability read is the worse failure; flag it if the backend needs the guarantee.
- **A deferred row's `view.name` follows a rung upgrade** (§3.1's log-time lookup), so
  `ui.interaction`'s pre-#108 behaviour of replaying the snapshotted name is gone. The row is still
  pinned to the view it happened in by `view.id`; only the *name* moved, and it moved to the one
  its own id now carries.

---

## When in doubt

1. Touching capture logic? → shared logic in `adapters/*.ts`, platform APIs in the
   `.web.ts` **and** `.native.ts` pair. Never one without the other.
2. Touching the wire body? → it's a cross-SDK contract. Backend sign-off first.
3. New `eventName`? → it must be on the allowlist, and that needs backend sign-off.
4. New attributes? → flatten to dot-notation, keep values primitive.
5. New public method? → `async`, and add it to `TelemetryBase` if it's platform-agnostic.
6. New dependency? → peer dep? native-only? optional? Don't bundle RN/React.
7. Changed behaviour? → update this file in the same commit — the affected section *and*
   Known gaps. It is the only description of this SDK there is.
