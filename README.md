# @nathanclaire/edge-telemetry-sdk

[![npm version](https://img.shields.io/npm/v/@nathanclaire/edge-telemetry-sdk.svg)](https://www.npmjs.com/package/@nathanclaire/edge-telemetry-sdk)
[![React Native](https://img.shields.io/badge/React%20Native-0.64%2B-61DAFB.svg?style=flat&logo=react)](https://reactnative.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-3178C6.svg?style=flat&logo=typescript)](https://www.typescriptlang.org/)

A lightweight Real User Monitoring (RUM) SDK for **React Native** apps (and a web build via
React Native Web). It captures performance, errors, network requests, device/network context,
navigation and user interactions, then ships them as JSON to the shared **EdgeTelemetryProcessor**
backend — the same backend the web, Android (Ionic) and iOS SDKs feed.

One SDK, two builds. The bundler picks `index.native.js` or `index.web.js` from the
`package.json` `exports` map — you always import from `@nathanclaire/edge-telemetry-sdk`.

---

## Contents

- [Upgrading to v4](#upgrading-to-v4-breaking)
- [Upgrading to v3](#upgrading-to-v3-breaking)
- [Install](#install)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Scrubbing PII — `beforeSend`](#scrubbing-pii--beforesend)
- [Sampling](#sampling--sessionsamplerate)
- [Distributed tracing](#distributed-tracing--tracehostallowlist)
- [API](#api)
- [What gets captured](#what-gets-captured)
- [Wire format](#wire-format)
- [Identity & IDs](#identity--ids)
- [Reliability](#reliability)
- [Debugging](#debugging)
- [Development](#development)

---

## Upgrading to v4 (breaking)

**Read [`docs/migration-v4.md`](docs/migration-v4.md) before you deploy.** Two changes break a
build — the `getDeviceInfo()` / `getNetworkInfo()` return shapes, and the six `@deprecated`
`UserProfile` fields. Everything else is silent: of the twenty discontinuities across 3.1.0 and
v4, **exactly one is visible at compile time** and the other **nineteen** surface at runtime or in
a chart — a saved filter quietly returns zero rows, or a series steps at the release boundary. The
note also lists the columns RN will never write (so nobody builds an ANR panel that stays empty
forever) and the five deliberate departures from the Android SDK.

**The one action item most consumers have:** if you called `setUserProfile()`, `setUserDetails()`,
`updateUserProfile()`, `setUserName()` or `setUserContact()` and never called `identify()`, your
profile data no longer reaches the wire at all. `user.name` / `.email` / `.phone` now ride
`user.profile.update` only, and `identify()` is what emits it. Add one call.

---

## Upgrading to v3 (breaking)

v3 is a **single clean break** onto the EdgeRum wire contract — no dual-emit, no v2 fallback.
If you're coming from v2, the headlines:

- `createTelemetry({ apiKey, endpoint, ... })` — **`apiKey` is now required** (must start with
  `edge_`; sent as **both** `X-API-Key` and `Authorization: Bearer`; init throws otherwise).
- The POST body is the `telemetry_batch` envelope; timestamps are ISO-8601; device/network data
  rides as a Context block on **every** event (the standalone `device_info`/`network_info`
  events are gone).
- Several event names changed and only the allowlist ships (`network_request` → `http.request`,
  `screen_view` → `navigation`, …); other `log()` names arrive as `custom_event`.
- New `debug` option (default `false`) silences all SDK console output.

Full breaking-change list and migration checklist: **[CHANGELOG.md](./CHANGELOG.md)**.

---

## Install

```bash
npm install @nathanclaire/edge-telemetry-sdk
```

### React Native peer dependencies

Native capture relies on these (install in your app):

```bash
npm install @react-native-async-storage/async-storage react-native-device-info @react-native-community/netinfo
cd ios && pod install
```

| Peer dep | Used for |
|---|---|
| `@react-native-async-storage/async-storage` | persisted replay of failed batches |
| `react-native-device-info` | `device.*` context (optional — degrades gracefully) |
| `@react-native-community/netinfo` | `network.*` context + `network_change` |

The **web build** uses browser APIs (`navigator`, `localStorage`) and needs none of the above.

---

## Quick start

`createTelemetry()` returns a `TelemetryNative` or `TelemetryWeb` instance — the bundler chooses.
**Every public method is `async`** (each awaits a lazily-built core), so `await` your calls.

### React Native

```typescript
import { createTelemetry } from "@nathanclaire/edge-telemetry-sdk";

const telemetry = createTelemetry({
  apiKey: "edge_xxxxxxxx",                                  // required; must start with "edge_"
  endpoint: "https://collector.example.com/telemetry", // full POST URL, used verbatim
  batchSize: 50,
  flushIntervalMs: 30000,
});

await telemetry.log("checkout_started", { cart_value: 42 });
```

### React Web

```typescript
import { createTelemetry } from "@nathanclaire/edge-telemetry-sdk";

const telemetry = createTelemetry({
  apiKey: "edge_xxxxxxxx",
  endpoint: "https://collector.example.com/telemetry",
  batchSize: 50,
  flushIntervalMs: 30000,
});

await telemetry.log("checkout_started", { cart_value: 42 });
```

Once constructed, the SDK **auto-starts** its collectors — you don't wire them up: session start,
crash/error capture, HTTP interception, frame + memory sampling, app foreground/background, and
(web) navigation. You only opt in to navigation and interaction capture on native (below).

---

## Configuration

```typescript
type TelemetryOpts = {
  apiKey: string;           // REQUIRED — must start with "edge_"; sent as X-API-Key AND Authorization: Bearer
  endpoint?: string;        // full collector POST URL (used verbatim). Default is a placeholder — always set it
  batchSize?: number;       // events per flush. Default 50 (matches the Android and iOS SDKs)
  flushIntervalMs?: number; // periodic flush. Default 30000; <= 0 disables the timer
  captureConsole?: boolean; // console.error -> app.error, console.warn -> a breadcrumb. Default OFF
  debug?: boolean;          // SDK-internal console diagnostics. Default false (silent)
  beforeSend?: BeforeSend;  // sync scrubbing hook, run at enqueue over events AND metrics
  sessionSampleRate?: number;    // 0.0-1.0, sticky per session. Default 1 (everything)
  traceHostAllowlist?: string[]; // hosts that may receive `traceparent`. EMPTY by default
  buildId?: string;         // app.build_id — the symbolication join key. Omitted when unset
  store?: Store;            // override the persisted-state port (localStorage / AsyncStorage)
  sender?: Sender;          // override the transport (mainly for tests)
};
```

**`beforeSend`, `sessionSampleRate` and `traceHostAllowlist` are constructor-only** — there is
deliberately no runtime setter. Registering one later leaves a window in which `session.started`,
the launch trace root and the earliest `http.request`s have already been enqueued unscrubbed.

- **`apiKey`** is validated at `createTelemetry()` — a key not starting with `edge_` throws
  immediately, so misconfiguration fails fast instead of silently dropping data. `tenant_id`
  is never sent; the backend resolves the tenant from the key.
- **`endpoint`** is the exact URL the SDK POSTs to. The collector terminates **`POST /telemetry`** —
  that is the path to point it at — `/collector/telemetry`, documented here previously, exists in
  no deployment and 404s.

---

## Scrubbing PII — `beforeSend`

```typescript
createTelemetry({
  apiKey: "edge_xxxxxxxx",
  endpoint: "https://collector.example.com/telemetry",
  beforeSend: (event) => {
    delete event.attributes?.["ui.target"];          // rewrite, or
    if (event.eventName === "custom_event") return null;  // drop outright
    return event;
  },
});
```

`(event) => event | null`, run **synchronously at enqueue** — before anything can reach the
network *or* the offline store, so a failed send can never put unscrubbed PII on disk. It sees
**metrics too**: `vital.target` is a raw CSS selector and the least sanitised key on the wire.

Three tiers, enforced by re-stamping after your hook returns — never by throwing, so an
over-broad `delete` loop cannot get your whole feed discarded behind a 2xx:

| Tier | Keys | Rule |
|---|---|---|
| **A — immutable** | `type`, `eventName`/`metricName`, `timestamp`, `session.*`, `event.sequence`, `sdk.*`, `app.*`, `device.platform`, `trace.id`, `span.id`, `parent.span.id`, `rum.action.id`, `view.id` | restored from the original — deletion *and* forgery |
| **B — rewritable, not deletable** | `device.id` | a hashed id is fine; a missing one 400s the batch |
| **C — free** | everything else: `user.*`, `http.*`, `error.*`, `ui.target`, `vital.target`, your `log()` data | untouched — this is where the PII lives |

Return `null` to drop an event deliberately (counted as `sdk.hook_dropped`). A hook that
**throws fails closed** — the event is dropped, never sent in its original form, and counted
separately as `sdk.hook_failed`. Two counters, because "my volume is down 40%" has to
distinguish a working scrubber from a broken one.

---

## Sampling — `sessionSampleRate`

```typescript
createTelemetry({ apiKey: "edge_xxxxxxxx", endpoint: "…", sessionSampleRate: 0.1 });
```

Rolled **once per session**, persisted with the session record and re-rolled at each rotation —
never per event, which would desynchronise the per-view counters. A sampled-out session sends
**nothing at all**, and ⚠ **crashes are not exempt**: 100% of crashes over 10% of sessions makes
the unfiltered crash-free query read 10× too high with no `WHERE` available to repair it.
`session.sample_rate` rides every row instead, so extrapolation is arithmetic. An out-of-range
or non-finite value warns and falls back to `1`.

---

## Distributed tracing — `traceHostAllowlist`

**Tracing is dark by default.** The allowlist is empty, so upgrading cannot break your network
calls on day one. Opt a host in and the SDK injects a W3C `traceparent` on requests to it,
joining your frontend spans to your backend traces:

```typescript
createTelemetry({
  apiKey: "edge_xxxxxxxx",
  endpoint: "https://collector.example.com/telemetry",
  traceHostAllowlist: ["api.example.com", "checkout.example.com"],
});
```

Bare hosts, **exact match**, **ports ignored** (⚠ a deliberate mismatch with `http.host`, which
keeps the port — do not join the two). No wildcards, no regexes, no same-origin exemption:
listing a host is your assertion that *that host's* CORS allows the header, and you cannot make
that assertion over a pattern. A malformed entry throws in dev and is dropped in production.

**`traceparent` is the only header the SDK writes, and the only one it reads.** No `b3`, no
`tracestate` — that is a sentence you must be able to state in a security review. The SDK never
strips or rewrites a `traceparent` you set yourself; it adopts a valid one and steps aside.

⚠ **Before you enable a host, add `traceparent` to its `Access-Control-Allow-Headers`.** Missing
it is what *"our app broke after we turned on tracing"* means — not an SDK fault. Adding the
header also turns previously-*simple* cross-origin GETs into preflighted ones, so set
`Access-Control-Max-Age` too. There is deliberately **no retry-without-the-header**: a rejected
preflight and a dead server are the same `TypeError`, and retrying would double-send a
non-idempotent POST.

Every request stamps `traceparent.outcome` (7 values) so a missing backend join is computable
rather than a mystery — `skipped_off_allowlist`, `skipped_no_cors`, `skipped_consumer_set`,
`adopted`, `injected_attributed`, `injected_expired`, `injected_unattributed`. ⚠ An unsampled
session injects no header at all.

---

## API

All methods return Promises. Available on both platforms unless marked **native-only**.

### Core

```typescript
log(event: string, data?: Record<string, any>): Promise<void>   // custom event (see allowlist note)
captureError(error: unknown, context?): Promise<void>            // report a handled error as app.error
flush(): Promise<void>                                           // force-send the queue now
shutdown(): Promise<void>                                        // clear the flush timer + final flush
```

```typescript
try {
  await pay();
} catch (err) {                         // `unknown` — a string, a plain object or an Error
  await telemetry.captureError(err, { "checkout.step": "pay" });
}
```

> **`app.crash` is SDK-owned.** It is emitted only for *unhandled* errors, so
> `COUNT(event_name='app.crash') / sessions` is a crash-free rate with no `WHERE` clause to
> forget. `log("app.crash", …)` is routed to `app.error` instead of manufacturing a crash row.

#### Making crashes symbolicatable — two lines you write

RN ships every crash stack minified, so each frame reads as a single letter. Two wiring steps
fix that, and the SDK does neither on your behalf:

```typescript
Error.stackTraceLimit = 50;             // in your entry file, before createTelemetry()

const telemetry = createTelemetry({
  apiKey: "edge_xxxxxxxx",
  endpoint: "https://collector.example.com/telemetry",
  buildId: process.env.GIT_SHA,         // ships as `app.build_id`
});
```

- **`Error.stackTraceLimit`** — the engine default is **10 frames**, well short of the SDK's
  2000-char stack cap (~26 frames), and ten frames of a rejected promise can be entirely library
  internals. The SDK **never assigns it**: raising it globally makes every `new Error()` in your
  app more expensive, invisibly. In dev it warns once, then leaves it to you.
- **`buildId`** — the symbolication join key, resolved as
  `(app, device.platform, app.build_id)`. A git SHA or CI run number. It is **omitted when unset
  and never derived from `app.version` + `app.build_number`** — under Expo Updates or CodePush
  the binary is unchanged, so a derived key would resolve against the wrong source map and give
  you frames that are plausible and wrong. Skip it and crashes stay unsymbolicated, which is at
  least honest.

`error.stacktrace` ships **raw and byte-for-byte** so `metro-symbolicate` can consume it; over
the cap the tail is dropped on a frame boundary and marked `… [truncated]`.

> **Allowlist note:** only the allowlisted event names reach the backend as-is. Any other name
> you pass to `log()` is shipped as `custom_event` with your original name in
> `attributes["event.name"]` — so custom events are preserved, not dropped.

### Identity

```typescript
identify(profile: {                     // EdgeRum-style — emits user.profile.update, the ONLY
  userId?: string;                      // event carrying user.name/.email/.phone/user.custom.*.
  name?: string; email?: string;        // `userId` sets the consumer-owned user.id the profile
  phone?: string; avatar?: string;      // upserts on; omit it and traffic stays anonymous —
  customAttributes?: Record<string, any>;   // the SDK never mints one.
}): Promise<void>

setUserId(id: string): Promise<void>    // consumer-owned user.id; truncated to 255 chars.
                                        // setUserId("") clears it — no empty string ships.
setUserProfile(profile): Promise<void>
setUserDetails(details): Promise<void>          // fullName/firstName/lastName/email/phone/avatar/customAttributes
updateUserProfile(updates): Promise<void>
getUserProfile(): Promise<UserProfile | undefined>
clearUserProfile(): Promise<void>
setUserName(fullName, firstName?, lastName?): Promise<void>
setUserContact(email?, phone?): Promise<void>
```

```typescript
await telemetry.identify({ userId: "u-42", name: "Ada Lovelace", email: "ada@example.com" });
```

> **The profile PII rides `user.profile.update` and nothing else.** `user.name`, `user.email`,
> `user.phone` and `user.custom.*` used to be on the Context block of *every* event, so a
> 10,000-event session put 10,000 copies of an email address on the wire. Caps are **255 / 255 /
> 50**; `user.custom.*` is bounded at 64 keys, 64-char keys and 255-char values, with
> non-primitive values `JSON.stringify`'d then truncated. Anything over is dropped, counted in
> `user.custom_dropped` and warned once in dev — a bad payload is never a throw. The other
> profile setters record state only: **call `identify()` for the profile to reach the wire.**

### Context accessors

```typescript
getDeviceInfo(): Promise<DeviceInfo>
getNetworkInfo(): Promise<NetworkInfo>
```

### Navigation & screens — **native-only**

```typescript
attachNavigation(navigationRef): Promise<void>   // React Navigation container ref → auto route tracking
trackRoute(from: string, to: string): Promise<void>
screenStart(name: string): Promise<void>         // → navigation
screenEnd(name: string): Promise<void>           // → screen.duration (dwell ms)
trackTap(name: string): Promise<void>            // → ui.interaction (§4.6) — see below
```

```typescript
import { NavigationContainer, useNavigationContainerRef } from "@react-navigation/native";

const navRef = useNavigationContainerRef();
// after the container mounts:
await telemetry.attachNavigation(navRef);
```

On **web**, navigation is auto-tracked (History API) — no wiring needed.

### User interactions (clicks) — **web, auto-started**

Every click emits `ui.interaction` — actionable or not. No wiring: the SDK attaches one
capture-phase listener to `document`.

**Names are derived only from elements that are actionable by role** — `<button>`, `<a href>`,
`<input type=submit|button|reset>`, `<summary>`, `<option>`, or `role="button|link|tab|checkbox|
radio|switch|menuitem|option"`. That is what keeps a clickable `<div>` full of customer data from
being auto-named. On React Native Web a `Pressable` maps to a role-bearing element automatically.

```html
<!-- Rung 1 wins over everything, works on role-less elements, and ships exactly as written -->
<div data-edge-action-name="Checkout — Step 2 of 3">…</div>
```

Below rung 1 the SDK reads, in order, `data-testid`, `aria-label`, `title`, then `textContent` —
each normalized (lowercased, non-alphanumerics folded to `_`) and capped at 64 characters.

| Click lands on | `ui.target` |
|---|---|
| role-bearing, a rung matched | the derived name |
| role-bearing, nothing to read | `unnamed` — add a `data-edge-action-name` |
| role-less with `cursor: pointer` | `unnamed` — same gap |
| role-less, default cursor | `surface` — whitespace, nothing to fix |

Two frustration signals ride along: **`ui.rage`** (≥3 clicks in 1000 ms on the *same element node*,
flagged once per burst, omitted when false) and **`ui.dead`** (no DOM change, no request and no
navigation within 1000 ms — judged on actionable clicks only, excluding text entry and
`download`/`target="_blank"` anchors, and **omitted** when it was not evaluated).

⚠ **The role gate is not a privacy guarantee.** `<button>Delete John Kamau</button>` still ships
that text. Use `beforeSend` to scrub it — there is deliberately no per-element masking attribute.

### Native taps — `trackTap(name)`

Native taps are **explicit-only**: `PressEvent.nativeEvent.target` is a node tag number with no
public API resolving it, so the root `<View>` cannot tell a tap on a button from a tap on padding.
`interactionProps()` and `user.interaction` are retired; name the taps you care about instead.

```tsx
<Pressable onPress={() => { telemetry.trackTap("checkout"); navigation.navigate("Cart"); }} />
```

The name is rung 1's equivalent — explicit author intent — so it ships **unnormalized and
uncapped**, `ui.name_source` has exactly two values (`edge_action`, or `none` for a blank name whose
`ui.target` is `unnamed`), and `surface` never appears. The row's timestamp and its
`view.id` / `view.name` / `session.id` are taken **at the tap**, so a tap that navigates is still
attributed to the screen it happened on.

⚠ **`ui.rage` on native is gated to named taps**, so a low count means *few named taps*, not happy
users — and **`ui.dead` is absent from every native row** (no DOM, hence no mutation signal), so any
dead-click rate must filter to the web build.

---

## What gets captured

Auto-started in the constructor (both platforms unless noted):

| Signal | `eventName` / `metricName` | Type |
|---|---|---|
| App launch | `app.start` | event |
| Session start / end | `session.started`, `session.finalized` | event |
| App foreground/background | `app_lifecycle` | event |
| Screen visit (exit, dwell, load time) | `view` | event |
| Route change / screen entry | `navigation` | event |
| Screen dwell time | `screen.duration` | event |
| HTTP request (fetch/XHR) | `http.request` | event |
| Connectivity change | `network_change` | event |
| Unhandled JS error / promise rejection | `app.crash` | event |
| `captureError()` / (opt-in) `console.error` | `app.error` | event |
| Identity update via `identify()` | `user.profile.update` | event |
| Click (web) | `ui.interaction` | event |
| Custom `log()` name (non-allowlisted) | `custom_event` | event |
| Memory sample | `memory_usage` | metric |
| Frame render window | `frame_render_time` | metric |
| Core Web Vitals (web only) | `LCP` `FCP` `CLS` `INP` `TTFB` | metric |

Both error events carry `error.type` (from `error.name`, never the minified `constructor.name`),
`error.source` — `global_handler` | `unhandled_rejection` | `cross_origin` | `console` | `reported`
— and, when present, `error.message` / `error.stacktrace`. `error.fatal` is **native-only**;
`error.breadcrumbs` (last 20 actions, JSON-stringified) rides `app.crash` only. Sessions rotate after 30 minutes of inactivity; `session.finalized` flushes
immediately and includes a journey summary + `sdk.error_count`.

**`view` is the screen-visit event** and replaces `page_load` on both builds. One row at each
of four exit boundaries — route change, backgrounding, session rotation, process death — carrying
`view.name`, `view.time_spent` (foreground only, so a night spent backgrounded is not charged as
dwell), `view.request_count` and `view.loading_time`. Loading time is **network settle**: the same
shared module on web and native, so one column means one thing. It is `null` when a view fetched
nothing — never `0`, which would make p75 track the cache-hit rate and render a backend caching win
as a frontend regression. `view.loading_time_outcome` (`settled` | `no_activity` | `capped` |
`abandoned`) always ships and is what tells the nulls apart: read **p75 where outcome = 'settled'**
plus **% capped**, never a naive average. ⚠ One screen visit can produce several `view` rows — a
background/foreground round trip splits it — so sum by `view.name`.

**Web-only signals** are emitted only by the web build — native never reports metrics it can't
honestly measure. The five **Core Web Vitals** ship on the metric path with attribution:
`vital.rating`, `vital.navigation_type`, `vital.target` and `vital.load_state` on every row, plus
per-vital breakdowns (LCP's four phases sum exactly to its `value`). CLS and INP are held as
running values and emitted when the tab is hidden, not on every change. All five are
**page-load-scoped**, so `view.id` on a vital row is always the *initial* view's — group vitals by
entry point, not by "the screen this happened on". ⚠ `page_load`, `resource_timing` and
`long_task` are **retired** in v4 — off the allowlist and unreachable. Their jobs are done by
`view`, `view.loading_time`, the vitals and `frame_render_time`; see
[`docs/migration-v4.md`](docs/migration-v4.md).

---

## Wire format

```
POST <endpoint>
Content-Type: application/json
X-API-Key: edge_xxxxxxxx
Authorization: Bearer edge_xxxxxxxx

{
  "type": "telemetry_batch",
  "timestamp": "2026-07-02T06:00:00.000Z",   // ISO 8601
  "batch_size": 3,
  "events": [ /* TelemetryEvent, ... */ ]
}
```

Each event/metric:

```typescript
type TelemetryEvent = {
  type: "event" | "metric";
  eventName?: string;                  // events
  metricName?: string;                 // metrics
  value?: number;                      // metrics
  timestamp: string;                   // ISO 8601
  attributes?: Record<string, any>;    // flat, dot-namespaced — includes the Context block
};
```

Every record carries the flattened **Context block** in `attributes`: `app.*`, `device.*`,
`network.*`, `session.*`, `device.id`, `user.id` (when set), `view.id` / `view.name`, and `sdk.*`
(`sdk.platform = "react-native-{ios|android|web}"`, `sdk.version`). This makes each record
self-describing and joinable without correlating against separate context events. It is frozen at
**39 keys** (contract §3.3) — a key the SDK has nothing for is **omitted**, never sent as null.

---

## Identity & IDs

SDK-minted ids use 16 hex chars of `crypto.getRandomValues` entropy and are suffixed with the
device OS:

```
device_{ms}_{16hex}_{ios|android|web}
session_{ms}_{16hex}_{ios|android|web}
```

Both ids follow the same rule on all three platforms. ⚠ `session.id` **gained** its `_web` suffix
in v4 — the value shape changed; nothing parses it.

**`device.id` is ours; `user.id` is yours.** `device.id` is minted once, persisted through the
`Store` and never rotated — not by `identify()`, not by a user-id change, not by
`clearUserProfile()` — so it is a stable anonymous-reach key that survives the login
transition. `user.id` is whatever you pass to `setUserId()` (truncated to 255 chars) and is
**omitted from the wire entirely** until you pass one; the SDK never mints an anonymous
stand-in. `clearUserProfile()` clears it — and leaves `device.id` untouched.

If storage is unavailable — incognito, a partitioned iframe, Safari ITP eviction, a full disk —
`device.id` lives for one process only and `device.id_ephemeral: true` rides the Context block
so that population can be excluded from device counts. The key is omitted when false.

`identify()` emits one `user.profile.update`, the only event carrying `user.name` / `email` /
`phone` / `user.custom.*`. Its optional `userId` sets `user.id`; without it the traffic stays
anonymous, since the SDK never mints one.

---

## Reliability

- **Batching:** events queue and flush when `batchSize` is reached or every `flushIntervalMs`.
- **Caps:** the in-memory queue holds 500 events and the persisted queue 500 events / 1 MB, both
  drop-oldest with `app.crash` evicted last. Anything dropped is reported on the wire as
  `sdk.events_dropped` + `sdk.drop_reason`.
- **Crashes don't wait for the batch:** an `app.crash` persists the queue and sends one batch
  immediately, with the crash moved to the front of it.
- **Retry:** failed sends retry with exponential backoff + jitter.
- **Persisted replay:** after final failure, batches are persisted (AsyncStorage on native,
  `localStorage` on web, key `telemetry_failed_events`) and replayed on next init — telemetry
  survives transient network loss. There is **exactly one replay path per build**, driven by the
  core: before v4 native had two wired at once and sent every recovered batch **twice**, while
  web had none at all and its offline queue only ever grew. A replay that fails again
  re-persists exactly one copy.
- **Web unload:** the web sender uses `fetch({ keepalive: true })` (not `sendBeacon`, which can't
  set the required credential headers) so in-flight batches survive page unload.
- **Auth:** every POST carries the credential twice — `X-API-Key` and `Authorization: Bearer`, same
  value. A shared collector reads the first, a segmented (bank / on-prem) one running `AUTH_MODE=jwt`
  reads the second; one build works against both, and `apiKey` may be an API key or an `edge_`-prefixed
  JWT.

---

## Debugging

The SDK is **silent by default**. To see its internal diagnostics while developing:

```typescript
createTelemetry({ apiKey: "edge_xxx", endpoint: "...", debug: true });
```

`debug: true` routes the SDK's `log`/`warn`/`error` to the console; with it off (the default),
the SDK writes nothing to the host app's console.

---

## Development

```bash
npm run build      # vite build → dist/ (web + native entries, ESM + CJS)
npm run dev        # vite in watch mode
npm test           # vitest run
npm run typecheck  # tsc --noEmit
npm run clean      # remove dist/
```

`dist/` and `*.tgz` are git-ignored — `dist/` is regenerated by the build and published via the
`package.json` `files` list. `prepare` runs the build, so installing this as a git dependency
builds it automatically.

Platform code is split by filename (`*.native.ts` / `*.web.ts`), not by runtime branching — the
bundler selects the file. When adding a capability, keep the native and web adapters in lockstep.

---

## License

ISC
