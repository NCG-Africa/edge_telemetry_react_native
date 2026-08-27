# RN SDK Wire Inventory — every key sent today, web vs native

**Scope:** `@nathanclaire/edge-telemetry-sdk` **v3.0.1**, tree at `9b7bf83`.
Resolves [#49](https://github.com/NCG-Africa/edge_telemetry_react_native/issues/49) under
map [#48](https://github.com/NCG-Africa/edge_telemetry_react_native/issues/48).
Amended under [#51](https://github.com/NCG-Africa/edge_telemetry_react_native/issues/51) to add
§8.7 and its annotations in §4.4, §4.5 and §4.8; key counts are unaffected.

Every key below is cited `file:line` against `src/`. Where the document and
`sdk-audit.yaml` disagree, the divergence is called out explicitly in §8 — the audit lists
events and common attributes but carries no cardinality, no null discipline, and no
per-build split, and in four places it describes behaviour the code does not have.

**Headline count: 73 distinct attribute keys** plus an unbounded `user.custom.*` family.
Of those, **62 ship on both builds**, **11 are native-only in practice**, and **0 are
web-only**. A further **2 keys are declared in a type but never assigned**, and **8 event
names sit on the allowlist with no producer at all**. Regenerate the count with the command
in Appendix B.

---

## 1. Envelope

`adapters/batch.ts:5-12`, shared verbatim by both senders, so the two POST bodies are
byte-identical.

| Key | Type | Null? | Cardinality | Source |
|---|---|---|---|---|
| `type` | string, const `"telemetry_batch"` | never | 1 | `batch.ts:7` |
| `timestamp` | ISO 8601 string | never | unbounded | `batch.ts:8` |
| `batch_size` | int | never | 1..batchSize | `batch.ts:9` |
| `events` | array of Event\|Metric | never, may be `[]`-length ≥1 | — | `batch.ts:10` |

Transport, identical on both builds except where noted:

| | Native | Web |
|---|---|---|
| Method / headers | `POST`, `Content-Type: application/json`, `X-API-Key` | same |
| Citation | `nativeSender.ts:21-28` | `webSender.ts:25-33` |
| `keepalive` | n/a | `true` — `webSender.ts:32` |
| Retry | 3 attempts, `500 * 2**n + jitter` — `nativeSender.ts:42-47` | 3 attempts, `n * 500` linear — `webSender.ts:43-45` |
| Offline store | `AsyncStorage`, key `telemetry_failed_events` — `nativeSender.ts:7-12` | `localStorage`, same key — `webSender.ts:6,9-13` |
| Replay on init | yes — `index.native.ts:51` | **no** — `webSender.ts:67` `replayFailedWeb` is exported but never called from `index.web.ts` |

**`X-API-Key` is omitted entirely when `apiKey` is falsy** (`nativeSender.ts:25`,
`webSender.ts:29`). The factory's `assertApiKey` guards the documented path
(`createTelemetry.web.ts:13-17`), but the `TelemetryWeb`/`TelemetryNative` constructors take
`apiKey?: string` (`index.web.ts:9`, `index.native.ts:9`), so direct construction ships
unauthenticated batches.

## 2. Event and Metric shape

`core/telemetry.ts:27-34`. One loose shape, not a discriminated union.

| Key | Type | Present on | Null? | Source |
|---|---|---|---|---|
| `type` | `"event"` \| `"metric"` | all | never | `telemetry.ts:28`, set `504` / `588` |
| `eventName` | string | events only | never on events, **absent** on metrics | `telemetry.ts:505` |
| `metricName` | string | metrics only | **absent** on events | `telemetry.ts:589` |
| `value` | number | metrics only | **absent** on events | `telemetry.ts:590` |
| `timestamp` | ISO 8601 string | all | never | `telemetry.ts:506` / `591` |
| `attributes` | object | all | never in practice | `telemetry.ts:507` / `592` |

`undefined` fields are dropped by `JSON.stringify`, so the backend sees *absent*, never
`null`, for `eventName`/`metricName`/`value`. There is no top-level `userId`, `sessionId` or
`location` — identity rides in `attributes`.

## 3. Context block — rides on **every** event and metric

Built once in `collectContext()` (`telemetry.ts:527-575`), called by both `log()`
(`telemetry.ts:493`) and `logMetric()` (`telemetry.ts:585`).

Assembly order, which is also the **overwrite** order — later wins:

1. `flattenWithPrefix('', deviceInfo)` — `telemetry.ts:545`
2. `flattenWithPrefix('network', networkInfo)` — `telemetry.ts:546`
3. `flattenWithPrefix('', data)` — **caller data, `telemetry.ts:547`**
4. the five identity/SDK keys — `telemetry.ts:548-553`
5. the user-profile block when a profile is set — `telemetry.ts:556-572`

Consequence worth stating in the contract: **caller `data` cannot override the identity
keys** (step 4 runs after step 3) but **can override any `app.*`, `device.*` or `network.*`
key**. `log("x", {"device.model": "spoof"})` ships.

### 3.1 Identity and SDK (always present, both builds)

| Key | Type | Null? | Cardinality | Source |
|---|---|---|---|---|
| `user.id` | string \| **null** | `null` only if a caller sets `setUserId(null)`-equivalent; otherwise generated | **per app launch — see §8.2** | `telemetry.ts:548`, minted `343-345`, assigned `192` |
| `session.id` | string | never | per session | `telemetry.ts:549`, minted `277-280` |
| `session.start_time` | ISO 8601 string | never | per session | `telemetry.ts:550` |
| `session.sequence` | int | never | 0..n, small | `telemetry.ts:551`, incremented only on a 2xx batch `642` |
| `sdk.platform` | string, const `"react-native"` | never | **1 — on both builds** | `telemetry.ts:552`, const `9` |
| `sdk.version` | string, from `package.json` | never | per release | `telemetry.ts:553`, const `10` |

ID formats (`telemetry.ts:278-279`, `344`):

```
session.id  session_{ms}_{16 hex}[_{ios|android}]   suffix native only; web omits it
user.id     user_{ms}_{16 hex}                      never suffixed
```

The suffix comes from `platform`, passed only by the native entry (`index.native.ts:45`);
the web entry deliberately omits it (`index.web.ts:38-39`). Entropy is `Math.random()` via
`randomHex` (`core/utils/uuid.ts`), not crypto — deliberate.

### 3.2 `app.*` and `device.*` — from the `DeviceInfo` interface

Declared `telemetry.ts:89-111`; flattened at `telemetry.ts:545`. Keys are **object property
names**, not string literals, which is why Appendix B has to read the interface.

| Key | Type | Native value / source | Web value / source | Null? | Cardinality |
|---|---|---|---|---|---|
| `app.name` | string | `getApplicationName()` — `deviceInfo.native.ts:28,53` | `document.title \|\| "WebApp"` — `deviceInfo.web.ts:17` | never | low |
| `app.version` | string | `getVersion()` — `native.ts:29,54` | `process.env.APP_VERSION \|\| "1.0.0"` — `web.ts:18` ⚠️ §8.4 | never | per release |
| `app.buildNumber` | string | `getBuildNumber()` — `native.ts:30,55` | `process.env.BUILD_NUMBER` — `web.ts:19` | **absent when undefined** | per build |
| `app.packageName` | string | `getBundleId()` — `native.ts:31,56` | `window.location.hostname` — `web.ts:20` | never | low |
| `device.id` | string | `getUniqueId()`, stable per install — `native.ts:22,59` | **regenerated per event** — `web.ts:23` ⚠️ §8.3 | never | native: per install · web: **per event** |
| `device.platform` | string | `Platform.OS` → `ios`\|`android` — `native.ts:60` | const `"web"` — `web.ts:24` | never | 3 |
| `device.platformVersion` | string | `getSystemVersion()` — `native.ts:37,61` | `navigator.appVersion` — `web.ts:25` | never | native: dozens · web: hundreds |
| `device.model` | string | `getModel()` — `native.ts:36,62` | **full user-agent string** — `web.ts:26` | never | native: hundreds · web: **thousands** |
| `device.manufacturer` | string | `getManufacturer()` — `native.ts:35,63` | const `"browser"` — `web.ts:27` | never | native: dozens · web: 1 |
| `device.brand` | string | `getBrand()` — `native.ts:34,64` | `navigator.vendor \|\| "unknown"` — `web.ts:28` | never | native: dozens · web: ~4 |
| `device.androidSdk` | string | API level, Android only — `native.ts:42,67` | **always absent** — `web.ts:32` | absent off-Android | ~15 |
| `device.androidRelease` | string | Android only — `native.ts:68` | absent — `web.ts:33` | absent off-Android | ~15 |
| `device.fingerprint` | string | Android only — `native.ts:43,69` | absent — `web.ts:34` | absent off-Android | **near-unique per device** |
| `device.hardware` | string | Android only — `native.ts:44,70` | absent — `web.ts:35` | absent off-Android | dozens |
| `device.product` | string | Android only — `native.ts:45,71` | absent — `web.ts:36` | absent off-Android | hundreds |
| `device.iosSystemName` | string | iOS only — `native.ts:48,74` | absent — `web.ts:38` | absent off-iOS | 1 |
| `device.iosDeviceName` | string | iOS only — `native.ts:49,75` | absent — `web.ts:39` | absent off-iOS | **near-unique — user-named device, PII** |

`undefined` values are stripped by `JSON.stringify`, so the seven Android/iOS keys are
*absent*, never `null`, on the other OS and on web. **Web populates none of them** — the
placeholders at `deviceInfo.web.ts:31-39` are explicit `undefined`.

`device.iosDeviceName` carries the user's own name for their phone ("Ada's iPhone") and
`device.fingerprint` is a near-unique Android build string. Both are PII-adjacent and both
ship on every single event today.

### 3.3 `network.*` — from the `NetworkInfo` interface

Declared `telemetry.ts:51-54`; flattened under the `network` prefix at `telemetry.ts:546`.

| Key | Type | Native source | Web source | Null? | Cardinality |
|---|---|---|---|---|---|
| `network.type` | string | `NetInfo.fetch().type` — `networkInfo.native.ts:16-18` | `conn.type \|\| "unknown"` — `networkInfo.web.ts:12`, fallback `"unknown"` `21` | never | native: ~7 · web: **effectively 1, see §8.5** |
| `network.isConnected` | boolean | `netState.isConnected ?? undefined` — `native.ts:19` | `navigator.onLine` — `web.ts:13`, `22` | **absent when undefined** on native | 2 |

`WebExtraNetworkInfo` (`telemetry.ts:56-61`) declares `downlink` and `effectiveType`, but the
web collector's assignments are commented out (`networkInfo.web.ts:14-15`) — **`network.downlink`
and `network.effectiveType` are never emitted.** They are two of the six declared-but-dead keys.

### 3.4 User profile — present only after `identify()` / `setUser*`

`telemetry.ts:556-572`. Every key here is written **only when its value is not `undefined`**
(`telemetry.ts:570`), so this whole block is absent from every event until the host app calls
`identify()`. Both builds, identical.

| Key | Type | Source | Cardinality |
|---|---|---|---|
| `user.name` | string | `telemetry.ts:558` ← `profile.name` `389` | per user |
| `user.fullName` | string | `telemetry.ts:559` | per user — **exact duplicate of `user.name`** |
| `user.firstName` | string | `telemetry.ts:560` | per user |
| `user.lastName` | string | `telemetry.ts:561` | per user |
| `user.email` | string | `telemetry.ts:562` | per user — **PII** |
| `user.phone` | string | `telemetry.ts:563` | per user — **PII** |
| `user.avatar` | string (URL) | `telemetry.ts:564` | per user |
| `user.createdAt` | int, **ms epoch** | `telemetry.ts:565`, set `360` | per user |
| `user.updatedAt` | int, **ms epoch** | `telemetry.ts:566`, set `361` | per profile write |
| `user.custom.*` | any primitive, flattened | `telemetry.ts:567` | **unbounded — host-defined key space** |

Two contract snags for the backend: `user.createdAt`/`user.updatedAt` are **ms epoch ints**,
the only two timestamps in the whole payload that are not ISO 8601; and `user.name` and
`user.fullName` are always written from the same field, so one of them is dead weight.
`user.custom.*` is the only unbounded *key* namespace in the payload — everything else has a
fixed key set.

## 4. Per-event attributes

Every event below carries §3 **plus** the keys listed. `eventName` is rewritten to
`custom_event` unless it is in `ALLOWED_NAMES` (`telemetry.ts:16-22`, rewrite `490-491`).

### 4.1 `session.started` — both builds

No own attributes (`telemetry.ts:306`). Emitted at init on both entries
(`index.web.ts:92`, `index.native.ts:84`) and on every `newSession()` (`telemetry.ts:326`).

### 4.2 `session.finalized` — both builds

| Key | Type | Null? | Cardinality | Source |
|---|---|---|---|---|
| `session.duration_ms` | int | never | unbounded | `telemetry.ts:312` |
| `session.event_count` | int | never | unbounded | `telemetry.ts:313` |
| `sdk.error_count` | int | never | small | `telemetry.ts:314` |

Triggered by 30-min idle rotation (`telemetry.ts:481-483`, threshold `11`) on both builds, and
additionally by `AppState → background` on native (`index.native.ts:93-95`). **Web has no
unload or `visibilitychange` hook into `finalizeSession`** — a web session is only finalized
by idle rotation, which itself only fires on the *next* `log()`. A web user who closes the tab
never produces a `session.finalized`.

### 4.3 `app_lifecycle` — both builds

| Key | Type | Values | Null? | Source |
|---|---|---|---|---|
| `app_lifecycle.state` | string | `"foreground"` \| `"background"` | never | `appLifecycle.ts:19` |

Edge-triggered only — the shared emitter suppresses the seed sample (`appLifecycle.ts:17`).
Native drives it from `AppState` (`index.native.ts:108-109`), web from `visibilitychange`
(`index.web.ts:77-79`).

### 4.4 `navigation` — **native only in practice**

| Key | Type | Null? | Cardinality | Source |
|---|---|---|---|---|
| `navigation.from_screen` | string \| **null** | `null` on the first `screenStart` | per screen | `navigationTracker.ts:14`, `screenTiming.ts:18` |
| `navigation.to_screen` | string | never | per screen | `navigationTracker.ts:15`, `screenTiming.ts:19` |
| `navigation.method` | string | never | **2** — `"push"` \| `"screen_start"` | `navigationTracker.ts:16` / `screenTiming.ts:20` |
| `navigation.route_type` | string | never | **1** — const `"screen"` | `navigationTracker.ts:17`, `screenTiming.ts:21` |

`navigation.from_screen` is the **only key in the whole SDK that is ever explicitly `null`**
on the wire (`screenTiming.ts:18`); the route-change path substitutes the string `"init"`
instead (`navigationNative.native.ts:26`). The backend must accept both.

Producers: React Navigation listener (`navigationNative.native.ts:21-29`), the public
`trackRoute` (`index.native.ts:159-162`) and `screenStart` (`index.native.ts:149-152`) — **all
native-only**. Web's producer exists (`navigationWeb.web.ts`) but never starts — see §8.1.

The three producers are **not** equivalent downstream. Only `screenStart` also arms
`ScreenTimingTracker`, and only `trackRoute` also sets `currentScreen`; the React Navigation
listener does neither, so it emits `navigation` and nothing else — see §8.7.

### 4.5 `screen.duration` — **native only**

| Key | Type | Null? | Cardinality | Source |
|---|---|---|---|---|
| `screen.name` | string | never | per screen | `screenTiming.ts:35` |
| `screen.duration_ms` | int | never | unbounded | `screenTiming.ts:36` |
| `screen.exit_method` | string | never | **1** — const `"navigation"` | `screenTiming.ts:37` |

Only reachable via `TelemetryNative.screenEnd()` (`index.native.ts:154-157`); `TelemetryWeb`
exposes no `screenStart`/`screenEnd`. Silently no-ops if `screenStart` was never called for
that name (`screenTiming.ts:29`).

**`attachNavigation` never arms it**, so an app that navigates via React Navigation without
also calling `screenStart` emits **zero** `screen.duration` events — see §8.7. "Native only" is
therefore narrower than it reads: native *and* manually instrumented.

### 4.6 `http.request` — both builds

Built by the shared `buildHttpAttributes` (`httpAttributes.ts:5-35`).

| Key | Type | Null? | Cardinality | Source |
|---|---|---|---|---|
| `http.url` | string | never | **unbounded — query strings not stripped** | `httpAttributes.ts:17` |
| `http.method` | string | never | ~8 | `httpAttributes.ts:18` |
| `http.status_code` | int | never; **`0` on transport failure** | ~40 | `httpAttributes.ts:19` |
| `http.duration_ms` | int | never | unbounded | `httpAttributes.ts:20` |
| `http.success` | boolean | never | 2 | `httpAttributes.ts:21` |
| `http.host` | string | **absent** on relative/invalid URL | dozens | `httpAttributes.ts:27` |
| `http.path` | string | **absent** on relative/invalid URL | **high — path params not normalized** | `httpAttributes.ts:28` |
| `http.request_size` | int | **absent** unless the body is a `string` | unbounded | `httpAttributes.ts:32` |
| `http.response_size` | int | **absent** when 0 or header missing | unbounded | `httpAttributes.ts:33` |

`http.host` and `http.path` come from `new URL(url)` inside a `try` (`httpAttributes.ts:25-31`):
a relative URL drops **both**, together, and the baseline five still ship. They are the only
two keys in the SDK with a coupled presence rule.

`http.request_size` is `String.length` — **UTF-16 code units, not bytes**
(`httpAttributes.ts:32`) — and only for string bodies, so `FormData`, `Blob` and
`URLSearchParams` uploads report nothing. `http.response_size` is `Number(content-length ?? 0)`
and is dropped when falsy (`httpAttributes.ts:33`), so a genuinely 0-byte response and a
missing header are indistinguishable.

Interceptors, and the one real divergence:

| | Native | Web |
|---|---|---|
| `fetch` | `interceptFetchNative.native.ts:25-63` | `interceptFetchWeb.web.ts:42-78` |
| `XMLHttpRequest` | **not intercepted** | `interceptFetchWeb.web.ts:89-134` |
| Self-POST suppression | `native.ts:46-47` | `web.ts:61-62` (fetch), `117-118` (XHR) |

Web XHR sets `error: "Network error"` when `status === 0` (`web.ts:127`), native sets the
caught exception (`native.ts:57`). Both only feed `http.success`; the error itself is never
put on the wire. **A failed request is indistinguishable from a 0-status response** except
via `http.success`.

### 4.7 `app.crash` — both builds

Built by the shared `buildCrashAttributes` (`crashCapture.ts:6-17`).

| Key | Type | Null? | Cardinality | Source |
|---|---|---|---|---|
| `crash.cause` | string | never | **4** — `Error` \| `UnhandledRejection` \| `ConsoleError` \| `ConsoleWarn` | `crashCapture.ts:4,11` |
| `crash.message` | any \| **null** | **explicit `null`** when absent | high | `crashCapture.ts:12` |
| `crash.stacktrace` | any \| **null** | **explicit `null`** when absent | very high | `crashCapture.ts:13` |
| `crash.fatal` | boolean | **absent** unless the producer supplies it | 2 | `crashCapture.ts:15` |
| `crash.breadcrumbs` | **JSON string**, not an array | never on `app.crash` | unique per crash | `telemetry.ts:498`, `breadcrumbs.ts:19-21` |

`crash.message` and `crash.stacktrace` are the only two keys that use the `?? null` idiom
(`crashCapture.ts:12-13`) — everywhere else absence means the key is dropped. The backend
needs a nullable column for these two and an absence rule for everything else.

`crash.fatal` is **native-only in practice**: only the `ErrorUtils` handler passes `isFatal`
(`crashHandlerNative.native.ts:21`); `window.onerror` has no equivalent and omits it
(`crashHandler.web.ts:16-19`).

`crash.breadcrumbs` is a **stringified JSON array** of `{name, timestamp}` (last 20,
`telemetry.ts:176`, `500`) — a nested payload inside a flat attribute bag, and the only
non-primitive value the SDK emits. Every non-crash event appends to the trail
(`telemetry.ts:500`); metrics deliberately do not (`telemetry.ts:583-599`).

Producers:

| Cause | Native | Web |
|---|---|---|
| `Error` | `ErrorUtils.setGlobalHandler` — `crashHandlerNative.native.ts:17-24` | `window.onerror` — `crashHandler.web.ts:15-20` |
| `UnhandledRejection` | `addEventListener` or `promise/rejection-tracking` — `native.ts:27-43` | `window.onunhandledrejection` — `web.ts:22-27` |
| `ConsoleError` / `ConsoleWarn` | `crashCapture.ts:45-46`, **default on** — `native.ts:12` | same shared patch, **default on** — `web.ts:12` |

`captureConsole` defaulting **on** means every `console.warn` in the host app — including
React's own dev warnings — becomes an `app.crash` with `crash.cause: "ConsoleWarn"`. Any
crash-rate metric the backend computes from `app.crash` is meaningless without filtering on
`crash.cause`.

### 4.8 `user.interaction` — **native only**

| Key | Type | Null? | Cardinality | Source |
|---|---|---|---|---|
| `interaction.type` | string | never | **1 in practice** — const `"tap"` | `interaction.ts:17`, `28` |
| `interaction.screen` | string | **key omitted** when unknown | per screen | `interaction.ts:18` |

Requires the consumer to spread `interactionProps()` onto their root `<View>`
(`index.native.ts:168-172`, `interaction.ts:24-31`). `interaction.screen` reads
`telemetry.currentScreen`, written in exactly two places: `screenStart` (`screenTiming.ts:16`)
and **`Telemetry.recordRouteChange`** (`telemetry.ts:678`). The identically-named
`NavigationTracker.recordRouteChange` (`navigationTracker.ts:12`) — the one the React
Navigation listener actually calls (`navigationNative.native.ts:26`) — does **not** write it.
So the key is **absent** for any app that navigates via React Navigation's listener without
also calling `screenStart` or `trackRoute`; see §8.7.

**There is no interaction capture of any kind on web** — no click, no input, no target-element
keys. `interaction.ts:5-6` states the DOM `target_tag`/`target_class` omission is intentional
for native; it is simply unbuilt for web.

### 4.9 `network_change` — both builds declared, **native only in practice**

| Key | Type | Null? | Cardinality | Source |
|---|---|---|---|---|
| `network.previous_type` | string | never (guarded on `!== undefined`) | ~7 | `networkChange.ts:20` |
| `network.type` | string \| **undefined** | can be `undefined` → **key dropped** | ~7 | `networkChange.ts:21` |

`network.type` here **shadows the Context-block value** — same key, emitted again from step 3
of `collectContext` (caller data), which overwrites step 2. Same value in practice, but the
backend should know the key arrives from two paths.

Edge-triggered on `type` change only (`networkChange.ts:18`). Native samples via
`NetInfo.addEventListener` (`networkInfo.native.ts:36`); web wires `connection.change`,
`online` and `offline` (`networkInfo.web.ts:47-51`) — but see §8.5: on web the compared value
is constant, so the event effectively never fires.

### 4.10 `user.profile.update` — both builds

No own attributes (`telemetry.ts:395`). The payload *is* the §3.4 block, which
`identify()` populates immediately before emitting (`telemetry.ts:388-395`).

### 4.11 `custom_event` — both builds

| Key | Type | Null? | Cardinality | Source |
|---|---|---|---|---|
| `event.name` | string | never on `custom_event` | **unbounded — host-defined** | `telemetry.ts:494` |

Every `log()` name outside `ALLOWED_NAMES` (`telemetry.ts:16-22`) lands here. Written
**after** `collectContext`, so a caller cannot shadow it.

## 5. Per-metric attributes

Metrics carry the identical §3 Context block (`telemetry.ts:585`). They do **not** extend
breadcrumbs and do **not** count as session activity (`telemetry.ts:578-581`), so a sampler
cannot keep a session alive past the idle rotation.

### 5.1 `frame_render_time` — both builds

`value` = p95 frame time in ms (`frameAggregate.ts:25`).

| Key | Type | Null? | Cardinality | Source |
|---|---|---|---|---|
| `frame.max_ms` | float | never | unbounded | `frameAggregate.ts:27` |
| `frame.p95_ms` | float | never | unbounded — **duplicates `value`** | `frameAggregate.ts:28` |
| `frame.dropped_count` | int | never | small | `frameAggregate.ts:29` |
| `frame.target_hz` | int | never | **1** — hardcoded 60 | `frameAggregate.ts:30`, default `frameDropsNative.native.ts:16` / `frameDropsWeb.web.ts:16` |
| `frame.source` | string | never | **1** — const `"requestAnimationFrame"` | `frameAggregate.ts:31`, passed `native.ts:29` / `web.ts:28` |

One metric per 10s window, both builds (`native.ts:17,27`, `web.ts:17,26`). `frame.target_hz`
is hardcoded 60 and never read from the display, so it is wrong on every 90Hz/120Hz device —
which also makes `frame.dropped_count` (frames slower than `2 × 1000/60`) wrong on those
devices.

### 5.2 `memory_usage` — both builds, **single-shot, and usually not at all**

`value` = used JS heap in MB (`memoryNative.native.ts:40`, `memoryWeb.web.ts:37`).

| Key | Type | Null? | Cardinality | Source |
|---|---|---|---|---|
| `memory.usage_mb` | float | never | unbounded — **duplicates `value`** | `memoryNative.native.ts:41` / `memoryWeb.web.ts:38` |
| `memory.pressure_level` | string | never | **3** — `low`\|`moderate`\|`high` | `native.ts:42` / `web.ts:39` |
| `memory.unit` | string | never | **1** — const `"MB"` | `native.ts:43` / `web.ts:40` |
| `memory.type` | string | never | **1** — const `"heap"` | `native.ts:44` / `web.ts:41` |
| `memory.source` | string | never | **native: 2 · web: 1** | `native.ts:45` / `web.ts:42` |

**`memory.source` means different things on the two builds** — `Platform.OS` (`"ios"` /
`"android"`) on native (`memoryNative.native.ts:45`) vs the const string
`"performance.memory"` on web (`memoryWeb.web.ts:42`). One key, two incompatible value
domains. This is the sharpest single divergence in the payload and the backend cannot type
it without a rule.

Emission is single-shot on both builds — see §8.6 for why, and why in practice it rarely
emits at all.

## 6. Platform divergence, key by key

**Native-only in practice (11 of 73):**

| Key | Why not on web |
|---|---|
| `crash.fatal` | only `ErrorUtils` supplies `isFatal` — `crashHandlerNative.native.ts:21`; `window.onerror` omits it — `crashHandler.web.ts:16-19` |
| `interaction.type`, `interaction.screen` | no web interaction capture exists at all (§4.8) |
| `navigation.from_screen`, `.to_screen`, `.method`, `.route_type` | declared on both, but web's producer never starts (§8.1) |
| `screen.name`, `.duration_ms`, `.exit_method` | `screenStart`/`screenEnd` are `TelemetryNative`-only — `index.native.ts:149-157` |
| `network.previous_type` | web's compared value is a constant, so the event never fires (§8.5) |

**Web-only: none.** Every key the web build can emit, native can too.

**Same key, divergent value domain (2):** `memory.source` — `Platform.OS` vs the const
`"performance.memory"` (§5.2) — and `device.model` — model string vs full user-agent (§3.2).
Both need an explicit rule in the contract.

**Declared in a type but never assigned (2):** `network.downlink` and `network.effectiveType`
(`telemetry.ts:59-60`); the web collector's assignments are commented out
(`networkInfo.web.ts:14-15`). They are not in the 73.

**Allowlisted event names with no producer (8):** `page_load`, `resource_timing`, `long_task`,
`LCP`, `FCP`, `CLS`, `INP`, `TTFB` (`telemetry.ts:20-21`). Nothing in `src/` calls `log()` or
`logMetric()` with any of them, so they contribute zero keys.

**Populated only on Android (5):** `device.androidSdk`, `device.androidRelease`,
`device.fingerprint`, `device.hardware`, `device.product`.
**Populated only on iOS (2):** `device.iosSystemName`, `device.iosDeviceName`.
On web all seven are explicit `undefined` (`deviceInfo.web.ts:31-39`) and so never reach the wire.

## 7. What web actually emits today

Correcting the map's premise. The web build emits **six** event names and **one** metric:

`session.started` · `session.finalized` (idle rotation only) · `app_lifecycle` ·
`http.request` · `app.crash` · `user.profile.update` · `custom_event` ·
`frame_render_time` (metric).

It does **not** emit `navigation` (§8.1), `screen.duration` (no public API), `user.interaction`
(unbuilt), `network_change` (§8.5), or — in any browser but desktop Chromium, and then only
once — `memory_usage` (§8.6). Map #48 lists `navigation`, `screen.duration`, `network_change`
and `memory_usage` among web's shipped events; none of the four are.

## 8. Findings the inventory forced out

Seven defects that change what the contract can promise. Each is reproducible from the
citation; §8.1, §8.6 and §8.7 were also confirmed by executing the code. §8.7 was added after
publication — it surfaced while resolving
[#51](https://github.com/NCG-Africa/edge_telemetry_react_native/issues/51), not during the
original sweep.

### 8.1 Web navigation capture never starts — `index.web.ts:120`

```ts
async autoTrackNavigation() {
    const { NavigationTrackerWeb } = await import("./adapters/web/navigationWeb.web");
    const inst = await this.instancePromise;
    return inst.start(navigationTracker);      // ← Telemetry has no start()
}
```

The core class exposes `autoTrackNavigation` (`telemetry.ts:269`), never `start`. The call
throws `TypeError`, which is swallowed by the fire-and-forget `.catch` in the constructor
(`index.web.ts:63-65`). `instancePromise` is `Promise<any>` (`index.base.ts:19`), so
`tsc --noEmit` cannot see it. `NavigationTrackerWeb` is fully written and completely dead:
**the web build has never emitted a `navigation` event.** One-word fix, but it means the
contract's web navigation story is a greenfield decision, not a compatibility constraint.

### 8.2 `user.id` is per app launch, not per user — `telemetry.ts:192`

`this.userId = opts?.userId ?? this.generateUserId()` runs in the constructor, and nothing
ever reads a persisted value back — the SDK writes to `AsyncStorage`/`localStorage` only for
failed batches (`nativeSender.ts:7`, `webSender.ts:6`). `newSession()` (`telemetry.ts:320-327`)
correctly leaves it alone, but every process start mints a fresh one. Native: cardinality =
app launches. Web: cardinality = **page loads**. Any "unique users" number computed from
`user.id` today is a session count. The contract must say whether v4 persists it, because
that decision changes the column's meaning retroactively.

### 8.3 Web `device.id` is regenerated on every event — `deviceInfo.web.ts:23`

`` id: `device_${Date.now()}_${uuidv4()}_web` `` sits inside `collect()`, and `collect()` is
called from `collectContext()` on **every** event and metric (`telemetry.ts:532`). Native's
`getUniqueId()` is stable (`deviceInfo.native.ts:22`). So web `device.id` has cardinality
equal to the event count — it is a per-row UUID wearing a device column's name. Promoting it
to an indexed column, as the Android contract does, would be actively harmful on web data.

### 8.4 Web `app.*`/`device.*` can vanish wholesale — `deviceInfo.web.ts:18-19`

`process.env.APP_VERSION` and `process.env.BUILD_NUMBER` are read unguarded. Bundlers that
statically replace `process.env.*` are fine; any runtime where `process` is undefined throws
a `ReferenceError` inside `collect()`, which `collectContext` catches (`telemetry.ts:531-535`)
and continues with `deviceInfo = {}`. The result is not a partial payload — it is **every
`app.*` and `device.*` key silently absent from every event**, with only a `debug.warn` that
is off by default. The backend must treat the whole `app.*`/`device.*` group as optional on web.

### 8.5 Web `network_change` cannot fire — `networkChange.ts:18` + `networkInfo.web.ts:12`

The emitter compares `type` only. The web collector yields `conn.type || "unknown"`, and
`NetworkInformation.type` is unimplemented in desktop Chrome, Firefox and Safari — so the
compared value is the constant `"unknown"` and the transition test never passes. Going offline
flips `network.isConnected`, which the emitter does not look at. Only Chrome-on-Android
populates `type`. Native is unaffected (`NetInfo` reports a real type).

### 8.6 `memory_usage` fires at most once, and usually zero times

Two independent causes:

1. **The periodic sampler is never started.** `Telemetry.trackMemoryUsage` calls
   `recordMemoryUsage()`, not `start()` (`telemetry.ts:262-267`). The `start(30000)` loops in
   `memoryNative.native.ts:55-65` and `memoryWeb.web.ts:53-63` have no caller.
2. **The one call it does make then throws.** `telemetry.ts:264` is
   `void memoryHandler.recordMemoryUsage().catch(...)`, but both implementations return
   `void` (`memoryNative.native.ts:32`, `memoryWeb.web.ts:29`) — `.catch` on `undefined` is a
   `TypeError`. The sample *is* taken first, then the throw propagates out of
   `TelemetryWeb.trackMemoryUsage` / `TelemetryNative.trackMemoryUsage` and is swallowed by
   the constructor's `.catch` (`index.web.ts:60-62`, `index.native.ts:77-79`).
   The `MemoryHandler` interface declares `Promise<void>` (`telemetry.ts:81`), but `inst` is
   `any`, so the mismatch is invisible to `tsc`.

On top of both: `performance.memory` is Chromium-only and absent under Hermes, so
`getNativeMemoryUsage()` / `getWebMemoryUsage()` return `null` and the emitter returns early
(`memoryNative.native.ts:34`, `memoryWeb.web.ts:31`) — **`memory_usage` almost never reaches
the wire on native at all.**

Both were confirmed by execution against the real `Telemetry` class:

```ts
const t: any = new Telemetry({ flushIntervalMs: 0 });
expect(typeof t.start).toBe("undefined");                       // §8.1
let called = 0;
expect(() => t.trackMemoryUsage({ recordMemoryUsage: () => { called++; } }))
  .toThrow(TypeError);                                          // §8.6 cause 2
expect(called).toBe(1);                                         // the sample lands, then it throws
```

### 8.7 `attachNavigation` produces no `screen.duration`, and no screen on taps

The two native screen paths are **disjoint**. `NavigationTrackerNative.attach` registers a
React Navigation `"state"` listener that calls `this.tracker.recordRouteChange(...)`
(`navigationNative.native.ts:21-29`) and **never touches `inst.screens`**.
`ScreenTimingTracker`'s `startTimes` map and `lastScreen` (`screenTiming.ts:5-6`) are written
only by the public `screenStart()` (`index.native.ts:149-152`), and `endScreen` returns
silently when `startTimes` holds no entry for that name (`screenTiming.ts:29`).

So a consumer who wires up `attachNavigation` — the zero-instrumentation path the SDK
advertises — emits `navigation` on every route change and **never a single `screen.duration`**,
no matter how long they stay on a screen.

The same split costs them `interaction.screen`, via a subtler route: **there are two methods
named `recordRouteChange`.**

| | Sets `currentScreen`? | Reached by |
|---|---|---|
| `Telemetry.recordRouteChange` (`telemetry.ts:677-680`) | **yes**, `:678` | the public `trackRoute()` (`index.native.ts:159-162`) |
| `NavigationTracker.recordRouteChange` (`navigationTracker.ts:12-19`) | **no** | the React Navigation listener (`navigationNative.native.ts:26`) |

`NavigationTrackerNative` holds its own `NavigationTracker` (`navigationNative.native.ts:14`)
and calls the adapter's method, which only logs. `Telemetry.recordRouteChange` delegates *to*
that same adapter method after setting `currentScreen`, so the two differ by exactly that one
assignment. The listener path therefore leaves `currentScreen` `undefined`, and every tap omits
`interaction.screen` (§4.8).

Net effect for an app using `attachNavigation` and nothing else:

| | Emitted? |
|---|---|
| `navigation` | ✅ |
| `screen.duration` | ❌ never |
| `interaction.screen` on `user.interaction` | ❌ key omitted |

Both halves were confirmed by execution against the real `Telemetry` and `NavigationTracker`:

```ts
const t: any = new Telemetry({ flushIntervalMs: 0, sender: { send: async () => {} } });

// what the React Navigation listener calls (navigationNative.native.ts:26)
await new NavigationTracker(t).recordRouteChange("init", "Home");
expect(t.currentScreen).toBeUndefined();      // no screen on taps
expect(t.screens.startTimes.size).toBe(0);    // ScreenTimingTracker never armed

const before = t.getEventCount();
await t.screens.endScreen("Home");
expect(t.getEventCount()).toBe(before);       // screenEnd no-ops: zero screen.duration

// what the public trackRoute() calls (index.native.ts:159-162)
await t.recordRouteChange("Home", "Checkout");
expect(t.currentScreen).toBe("Checkout");     // the one assignment that differs
```

Neither `sdk-audit.yaml` nor `CLAUDE.md` records this; both present `attachNavigation` and
`screenStart` as peer entry points. §4.4 and §4.5 above are annotated accordingly.

### 8.8 Corrections to `sdk-audit.yaml` and `CLAUDE.md`

- Both credit web with `navigation` capture. It has never worked (§8.1).
- Both describe `memory_usage` as "single-shot". It is single-shot *and* throws *and* is
  Chromium-only (§8.6).
- `CLAUDE.md` lists as a known gap that `index.base.ts:37` imports the **native** crash
  handler in shared code and "the web build resolves it at runtime and rejects". It does not:
  `TelemetryWeb.trackErrors` (`index.web.ts:83-88`) **overrides** the base method, so
  `index.base.ts:36-41` is unreachable from the web entry. It is dead code, not a live bug.
- Neither records that `user.id` is per-launch (§8.2) or that web `device.id` is per-event
  (§8.3) — the two facts that most change how the backend should index this data.
- Both present `attachNavigation` and `screenStart` as peer entry points. They are not:
  `attachNavigation` alone yields no `screen.duration` and no `interaction.screen` (§8.7).

## Appendix A — the 73 keys

Grouped by namespace, alphabetical within each. **N** = native-only in practice (§6);
everything else ships on both builds. `user.custom.*` is excluded — it is an unbounded
host-defined namespace, not a fixed key.

| Namespace | n | Keys |
|---|---|---|
| `device.*` | 13 | `androidRelease` `androidSdk` `brand` `fingerprint` `hardware` `id` `iosDeviceName` `iosSystemName` `manufacturer` `model` `platform` `platformVersion` `product` |
| `user.*` | 10 | `avatar` `createdAt` `email` `firstName` `fullName` `id` `lastName` `name` `phone` `updatedAt` |
| `http.*` | 9 | `duration_ms` `host` `method` `path` `request_size` `response_size` `status_code` `success` `url` |
| `session.*` | 5 | `duration_ms` `event_count` `id` `sequence` `start_time` |
| `crash.*` | 5 | `breadcrumbs` `cause` **N** `fatal` `message` `stacktrace` |
| `frame.*` | 5 | `dropped_count` `max_ms` `p95_ms` `source` `target_hz` |
| `memory.*` | 5 | `pressure_level` `source` `type` `unit` `usage_mb` |
| `app.*` | 4 | `buildNumber` `name` `packageName` `version` |
| `navigation.*` | 4 | **N** `from_screen` **N** `method` **N** `route_type` **N** `to_screen` |
| `sdk.*` | 3 | `error_count` `platform` `version` |
| `screen.*` | 3 | **N** `duration_ms` **N** `exit_method` **N** `name` |
| `network.*` | 3 | `isConnected` **N** `previous_type` `type` |
| `interaction.*` | 2 | **N** `screen` **N** `type` |
| `app_lifecycle.*` | 1 | `state` |
| `event.*` | 1 | `name` |
| | **73** | |

## Appendix B — regenerate the count

Two sources, because the SDK builds attribute keys two ways: string literals at emit sites,
and object property names flattened out of the `DeviceInfo`/`NetworkInfo` interfaces by
`flattenWithPrefix` (`telemetry.ts:601-618`). A grep for literals alone misses all 19
`app.*`/`device.*`/`network.*` keys.

Run from the repo root:

```bash
{
  # (a) literal keys at emit sites:  "k.v": …   |   attributes['k.v'] = …
  grep -rhoE "[\"'][a-z][a-zA-Z0-9_]*(\.[a-z][a-zA-Z0-9_]*)+[\"'][[:space:]]*(:|\][[:space:]]*=)" \
    src --include='*.ts' --exclude='*.test.ts' \
    | sed -E "s/[\"'][[:space:]]*(:|\][[:space:]]*=)\$//; s/^[\"']//"

  # (b) Context keys the flattener derives from the DeviceInfo / NetworkInfo interfaces
  awk '/^export interface (DeviceInfo|NetworkInfo)/,/^\}/' src/core/telemetry.ts \
    | awk '
        /^export interface NetworkInfo/            { p="network"; next }
        /^    (app|device):[[:space:]]*\{/         { p=$1; sub(":","",p); next }
        /^    \};?$/                               { if (p!="network") p=""; next }
        p && /^ +[a-zA-Z]+\??:/                    { k=$1; sub(/\??:.*/,"",k); print p"." k }
      '
} | sort -u | tee /dev/stderr | wc -l
```

Expected at `9b7bf83`: **73**.

The `:` / `] =` anchor is what separates attribute keys from event names — event names appear
as `log("app.crash", …)` and as bare members of `ALLOWED_NAMES`, never followed by a colon.
Drop the anchor and part (b) together and the count comes back **63**: eight non-keys mixed in
(`app.crash`, `http.request`, `screen.duration`, `session.started`, `session.finalized`,
`user.interaction`, `user.profile.update`, and the bare `user.custom` prefix) and **18 real
keys missing**. That 63 is the number a naive grep produces, and it is wrong in both
directions — which is exactly the trap this appendix exists to document.
