# Changelog

All notable changes to `@nathanclaire/edge-telemetry-sdk` are documented here.

## 4.0.0

**The EdgeRum v4 wire.** A single release, no dual-emit and no v3 fallback: the Context block is
frozen at its final 39-key shape, the PII moved off every event onto `user.profile.update`, the
error surface split into `app.crash` / `app.error`, and `view`, `ui.interaction`, `app.start`,
trace/span and the Core Web Vitals arrive. **Read [`docs/migration-v4.md`](docs/migration-v4.md)
before deploying** — of its twenty discontinuities exactly one is visible at compile time; the
other nineteen surface in a chart, silently.

### Added

- **The v4 migration note ships with the release, not after it** (#109, contract §12).
  [`docs/migration-v4.md`](docs/migration-v4.md) enumerates all twenty discontinuities across
  3.1.0 and v4 and marks which are visible at compile time. **Exactly one of the twenty is** —
  #2, the `getDeviceInfo()` / `getNetworkInfo()` return shapes. The six `@deprecated`
  `UserProfile` fields are the only other compile-time-visible change and are **not** among the
  twenty. So two changes break a build and the remaining **nineteen** break a chart instead:
  no compile error, no runtime error, no log line. That is precisely why the note cannot trail
  the release. It is shipped in the npm tarball, not only in the repo. It also documents **the
  columns RN will never write** — the ANR, hang, battery/power, `app.exit` and native-crash
  surface, plus `rum_trace_spans` and `rum_user_actions` in full — so nobody builds a panel that
  stays empty forever, and records the **five deliberate departures from Android** (§13) so the
  next person diffing the two SDKs does not file a decision as drift.

  ⚠ `sdk-audit.yaml` is **not** regenerated, against #109's wording. It was retired on purpose
  (see `CLAUDE.md`'s header): a second hand-maintained description of the same behaviour drifts
  from the first, and two documents disagreeing is worse than one being incomplete. `CLAUDE.md`
  plus `docs/backend-wire-contract.md` are what replaced it.

### Removed

- ⚠ **Three more event names come off the allowlist — retired, not deferred** (#109, §4.0 /
  §10.2): `page_load`, `resource_timing` and `long_task`. They are **unreachable**, so a consumer
  calling `log("page_load")` now gets `custom_event` carrying `event.name: "page_load"`, as with
  any unknown name. All three were allowlisted but **never produced**, so no chart exists on any
  of them and the retirement adds nothing to the migration story. Their jobs are done: `page_load`
  three ways over (`view` with `load_type: initial_load`, `view.loading_time`, and TTFB/FCP/LCP
  with the phase splits), `resource_timing` by nothing — it would put hundreds of per-asset rows
  in a namespace with no column and exceed the 500-event queue on one asset-heavy view — and
  `long_task` by `frame_render_time`, since a >50 ms long task **is** a long rAF delta and both of
  the long-task APIs are Chromium-only.

  With the fourth retirement — `user.interaction`, which came off with #102 — and `view`,
  `ui.interaction`, `app.error` and `app.start` in, **the allowlist's v4 movement is net zero**.
  All four retirements are asserted unreachable on both builds.

- **The Context block is frozen at its final 39-key shape** (#108, wire contract §3.3 / §3.4 /
  §3.1). This is the integration point: every prior ticket contributed keys, this one makes the
  block match the contract exactly and removes what should never have been there.
  `src/context.web.test.ts` and `src/context.native.test.ts` assert the set **key by key on both
  builds, present and omitted** — on this wire absent means "the SDK had nothing", so a key
  shipped as `undefined` was itself a defect.

  **New keys.** `device.cpu_abi` and `device.low_ram` (native only — "does this crash only on
  cheap devices?"), and `device.screen_density` / `device.screen_width_px` /
  `device.screen_height_px` / `device.orientation` on **both** builds, because CLS and LCP scale
  with the viewport and orientation splits CLS, dwell and interactions alike. All four are read on
  every event: a window resizes and a phone rotates mid-session.

  **`user.id` is now the only `user.*` key on the Context block.** `user.name` / `.email` /
  `.phone` / `.custom.*` moved to `user.profile.update` in #107; the six retired fields
  (`fullName`, `firstName`, `lastName`, `avatar`, `createdAt`, `updatedAt`) have no wire key at
  all.

### Changed

- ⚠ **`sdk.platform` is now `react-native-{ios|android|web}`**, not the constant `"react-native"`
  (§3.3, §12's item 10). It joins Flutter's `flutter-{os}` shape, taking the column from three
  conventions to two. **A saved filter on `sdk.platform = 'react-native'` returns zero rows** —
  and a web-only or native-only query was not expressible at all before this. The domain is
  `Platform.OS`-derived and is **not** a closed three-value enum: RN-Windows would emit
  `react-native-windows`, and a `CHECK` on three values rejects it.

- ⚠ **`session.id` gained its `_web` suffix on the web build** (§3.3, §12's item 13), so
  `session_{ms}_{16hex}_{ios|android|web}` and `device.id` now follow one rule. A value-shape
  change; nothing parses it.

- **Attribution freezes at span start** (§3.1). A span-carrying row — `http.request`,
  `ui.interaction` — now reports the `session.id`, `session.start_time` and `view.id` that were
  live when the span **started**, not when it was emitted. §4.2's 4-hour cap can rotate a session
  while a request is in flight, which used to put S1's trace on an S2 row. `view.name` still
  resolves at **log time**, by lookup on the frozen `view.id`, so a row can never carry a name
  that disagrees with its own id. Network, device state and `user.*` stay log-time on purpose.

  ⚠ **`ui.interaction` no longer replays its snapshotted `view.name`.** A rung upgrade inside the
  emit window renames the view *in place* (`view.id` never moves), and the row now shows the
  upgraded name. The freeze is on the id and the timestamp.

- **An `undefined` attribute value is dropped at the flattener.** Wire-neutral — the sender's
  `JSON.stringify` already dropped it — but the in-memory bag now matches the wire, so
  `beforeSend` is never handed a key that would not have shipped. ⚠ One behaviour change:
  `log("x", { "device.model": undefined })` used to blank the key and now leaves the real value in
  place, because the override never enters the bag.

### Removed

- ⚠ **`device.fingerprint` and `device.iosDeviceName` are gone outright** (§3.4). The device-info
  adapter no longer calls `getFingerprint()` or `getDeviceName()` at all: a build string that
  merges handsets — deleting it *repairs* device identity — and the user's own name for their own
  phone, which is real PII with no column and no reader. Neither is collected any more.

### Added

- **The profile PII rides `user.profile.update` and nothing else** (#107, wire contract §4.10).
  `user.name` / `user.email` / `user.phone` / `user.custom.*` were on the Context block of
  **every** event, so a 10,000-event session put 10,000 copies of an email address on the wire
  and at rest to populate a per-user upsert table that needs it **once**. Copies per session go
  N → 1, and it is self-healing: the profile is in-memory, so `identify()` re-fires every launch.

  `user.id` stays on the Context block — it is the join key, not the payload — and **`identify()`
  gains an optional `userId`**, so the one call that sends a profile also sets the key it upserts
  on. It still never mints one: omit `userId` and the traffic stays anonymous.

  Caps are **255 / 255 / 50** (`rum_users.phone` is `VARCHAR(50)`, and the mismatch loses the
  whole profile behind a 2xx). `user.custom.*` is bounded at **≤64 keys, 64-char keys, 255-char
  values**, with consumer key casing passed through verbatim; a non-primitive value is
  `JSON.stringify`'d then truncated. Overflow is dropped, counted in **`user.custom_dropped`**
  and warned once in dev — **never a throw**.

  ⚠ **Migration:** the other profile setters record state only. `setUserProfile()`,
  `setUserDetails()`, `updateUserProfile()`, `setUserName()` and `setUserContact()` no longer
  reach the wire on their own — **call `identify()` for the profile to be sent.**

  ⚠ **Six public profile fields are `@deprecated` but still work**, for removal in v5:
  `fullName`, `firstName`, `lastName`, `avatar`, `createdAt`, `updatedAt`. Their wire keys
  (`user.fullName`, `user.firstName`, `user.lastName`, `user.avatar`, `user.createdAt`,
  `user.updatedAt`) are **gone outright** (§3.4) — `user.fullName` duplicated `user.name`, the
  next three had no column and no reader, and the last two were byte-identical every session.

### Fixed

- **One offline-replay path per build — native sent every recovered batch twice, web sent none at
  all** (#113). The persisted queue is the SDK's answer to a flaky network, and on neither build
  did it work. Native had *two* replay paths wired at once — the entry's standalone
  `replayFailedNative()` and the core's `Sender.replayFailed()` — so every batch recovered from
  disk was POSTed **twice**, duplicating rows the backend then had to dedup on
  `(session.id, event.sequence)`. Web had **neither**: nothing ever called its drain, so
  `telemetry_failed_events` only ever grew until the store's cap started evicting the oldest
  batches. A web consumer on a flaky network lost telemetry the SDK had already successfully
  written to disk.

  **The one path is `Sender.replayFailed()`, called once from the core constructor.** The
  standalone `replayFailedNative` / `replayFailedWeb` exports are **deleted, not deprecated** — a
  second entry point is exactly what caused the double-send, and leaving it importable invites
  the bug back. The decode rules and the store key live in `adapters/failedEvents.ts` so the two
  senders cannot drift on them. A replay that fails again **re-persists exactly one copy**: it
  never goes through `flush()`, so `onFailure()` does not persist it a second time.

  The native drain is wrapped in a per-sender `guardedDrain()`. `takeFailed()` clears the key
  before the send is attempted, but on an async store two *concurrent* drains both read the
  payload before either removes it — so the second caller is handed the first's in-flight promise
  instead. ⚠ **Web has no guard, and that is the `SyncStore` guarantee, not an oversight**: on
  `localStorage` the key is already cleared when the drain first yields, so a second caller reads
  a miss and returns. The race is unconstructable there, and a guard whose bucket is permanently
  empty is eventually read as one that is working.

  ⚠ `webSender.replayFailed()` **rejects where the deleted `replayFailedWeb` swallowed.** Core's
  constructor `.catch` absorbs it and warns, so nothing changes for a consumer — but a path that
  was unconditionally quiet now has an error edge, and both builds report replay failure the same
  way as a result.

- **A bad `identify()` no longer crashes the host app** (#107). `flattenWithPrefix` had no depth
  guard, so a cyclic value in `customAttributes` recursed to a **`RangeError` inside the SDK** —
  in the consumer's render tree, on a call that only meant to set a name. The bounded
  `user.custom.*` rule closes it, along with two more: raw arrays violated the primitive-values
  rule, and nested objects recursed into the bag. The flattener itself gained a depth cap of 8
  for the general `log(name, data)` path, stringifying at the cap rather than handing the object
  through — a cycle passed through raw would only move the throw to `JSON.stringify` in the
  sender.

  ⚠ **Arrays in a `log(name, data)` payload now ship as JSON strings** — `{ tags: ["a","b"] }`
  ships `'["a","b"]'` where it shipped a raw array before. The depth cap alone could not close
  the hole: the flattener never recursed into arrays, so a cycle reached *through* one never met
  the depth counter, threw in the sender's `JSON.stringify`, and `flush()`'s catch **swallowed
  it and lost the whole batch silently — no counter, no log.** The collector renders a raw array
  through `fmt.Sprint` as Go map syntax anyway, so JSON is the better of the two shapes, but it
  is a value change on an existing key for anyone already passing arrays.

### Added

- **Identity: `device.id` is ours, `user.id` is yours** (#91, wire contract §3.2/§3.3). One
  column used to hold both `user_1749…_a3f9…` and `cust-88213`, so no query could separate a
  visitor from a customer. Now:

  `device.id` is **self-minted by the SDK** — `device_{ms}_{16hex}_{ios|android|web}` — written
  through the `Store` under `telemetry_device_id`, uninstall-scoped, and it **never rotates**:
  not on `identify()`, not on a user-id change, not on `clearUserProfile()`. It is no longer
  `getUniqueId()`, which already carries two lifetimes on RN alone (ANDROID_ID survives
  reinstall, `identifierForVendor` does not) and would make one identity column mean two
  things. Neither device-info adapter mints an id any more.

  `user.id` is **consumer-supplied**, truncated to 255 chars at source, and **omitted from the
  wire entirely** on anonymous traffic — no `""`, no placeholder. So
  `COUNT(DISTINCT device.id)` is anonymous reach, `COUNT(DISTINCT user.id)` is known-user
  reach, and because `device.id` is stable across the login transition,
  `GROUP BY device.id` stitches an anonymous session to the account it eventually signs into.

  **`device.id_ephemeral: true`** rides the Context block when the `Store` reported
  `unavailable` on either the read or the write — incognito, a partitioned iframe, Safari ITP
  eviction, a full disk — and is omitted when false. It is not derivable query-side: an
  ephemeral id appears once and never returns, indistinguishable from a real device installed
  and uninstalled the same day, and without the flag that population inflates device counts
  and reads as traffic growth.

  Id entropy moves from `Math.random()` to **`crypto.getRandomValues`**. A persisted
  `device.id` collision is *permanent* where a session collision was transient — two handsets
  merge into one device row and one rate-limit bucket, forever. RN has no WebCrypto, so the
  native entry side-effect-imports `react-native-get-random-values`, already a declared
  dependency that was never imported; it is a no-op wherever `crypto` already exists. There is
  no `Math.random()` fallback — `randomHex` throws with a reinstall instruction, because
  silently minting a weak id for a value that persists forever is worse than refusing.

  `clearUserProfile()` now clears `user.id` alongside the profile (contract §3.2), and
  `setUserId("")` clears it rather than shipping an empty string. `device.id` is untouched by
  both.

### Removed

- **`generateUserId()`** is gone from `TelemetryBase` and the core (#91). The SDK no longer
  mints anonymous user ids at all, so an accessor for the mint has nothing to return. Set the
  id you own with `setUserId(id)` or `setUserProfile({ userId })`.
- **`uuid`** (and `@types/uuid`) dropped from dependencies (#91) — the two device-info
  adapters were its only consumers and neither mints an id any more.

### Added

- **The `Store` port** (#89) — a narrow `get` / `set` / `remove` interface over persisted
  state, declared in shared core (`src/core/store.ts`) with no React Native import. v4 moves
  `device.id`, session resume, the sticky sample rate and the capped offline store into
  shared core, and shared core cannot reach AsyncStorage; that is what forces the seam. It is
  architecture, not testability.

  **Web is synchronous and native is asynchronous, and the port keeps the difference in the
  types.** `SyncStore` (`adapters/web/store.web.ts`, over `localStorage`) has completed its
  read by the time `get()` returns; `AsyncStore` (`adapters/native/store.native.ts`, over
  `AsyncStorage`) settles later. That asymmetry is exactly why the crash-loss window *closes*
  on web and only *narrows* on native, so it is not papered over with a uniform `Promise`
  signature — a caller can depend on the web side being synchronous. Shared code that doesn't
  care takes the `Store` union and `await`s either.

  **Storage-unavailable is a first-class outcome, not an error.** Reads return
  `hit` | `miss` | `unavailable`. Incognito, partitioned iframes, Safari ITP eviction and full
  disks land on `unavailable` — never a throw, and never conflated with a key that simply
  isn't there. That population is what v4's `device.id_ephemeral` reports (wire contract §3.2).

  The store is injectable via `TelemetryOpts.store` and defaulted per build by the entry.
  `memoryStore()` ships alongside it — a real in-memory implementation, configurable to either
  build's shape so the sync/async asymmetry can be tested deliberately; a direct
  `new Telemetry()` with no injected store falls back to `memoryStore({ unavailable: true })`.

### Changed

- **Both senders' offline queue now goes through the port.** `webSender` and `nativeSender`
  no longer touch `localStorage` / `AsyncStorage` directly; each entry builds one store and
  hands it to both the sender and core, so a consumer who injects a store governs the offline
  queue too. Same key (`telemetry_failed_events`), so queues written by 3.1.0 still replay.

  Three things fall out of it:

  - **Web persists synchronously, native awaits.** `onFailure()` runs on the unload path, and
    on web the write has landed before the promise settles — the crash-loss window closes
    there and only narrows on native. `TelemetryOpts.store` is typed `SyncStore` on the web
    build for exactly this reason; native takes the union, since it only ever awaits.
  - **A corrupt queue no longer takes startup down.** The old code was a bare
    `JSON.parse(stored || "[]")` that threw straight through `replayFailed()` on a
    half-written payload. Decoding now yields "nothing to replay", and the key is cleared on
    any hit — so junk is dropped once rather than re-read and re-dropped on every launch.
  - **Storage being unavailable is logged, not thrown.** The batch is already lost; throwing
    would only lose the next one too.

  The offline store is still unbounded. Capping it needs `sdk.events_dropped` and
  `sdk.drop_reason="store_full"` on the wire — v4, and backend sign-off.

## 3.1.0

**Wire fix, shipped alone and ahead of v4.** Seven Context-block keys were spelled camelCase,
so the processor read them as absent. Five columns start filling the day you upgrade. No
backend work is required, and nothing else from the v4 programme rides along in this release.

### Fixed

- **Seven Context keys respelled to their contract spelling** (§9.3 of the backend wire
  contract). The camelCase was never authored — it was the TypeScript interface shape leaking
  through the Context flattener — so the fix is a rename on the `DeviceInfo` / `NetworkInfo`
  interfaces:

  | was | now |
  |---|---|
  | `app.buildNumber` | `app.build_number` |
  | `app.packageName` | `app.package_name` |
  | `device.platformVersion` | `device.platform_version` |
  | `device.androidSdk` | `device.android_sdk` |
  | `device.androidRelease` | `device.android_release` |
  | `device.iosSystemName` | `device.ios_system_name` |
  | `network.isConnected` | `network.is_connected` |

- **`app.packageName` was live cross-tenant misattribution, not just an empty column.** The
  processor's `rum_apps` table is UNIQUE on `package_name` and upserts
  `ON CONFLICT (package_name) DO UPDATE`. Reading the camelCase key yielded `""`, so **every
  React Native app on the platform, across every tenant, upserted onto one empty-string row** —
  permanently attributed to whichever tenant inserted it first. App-level segmentation did not
  exist for React Native before this release.

### ⚠ Breaking for consumers of `getDeviceInfo()` / `getNetworkInfo()`

These two methods **return a different object shape** — the seven fields above are renamed on
the returned `DeviceInfo` / `NetworkInfo`. The break is structural only: the `DeviceInfo` type
is not exported from the package entry, so **you will not get a compile error**. If you read
`(await telemetry.getDeviceInfo()).app.packageName` or `.device.platformVersion`, or
`(await telemetry.getNetworkInfo()).isConnected`, those reads now silently return `undefined`.
Update them to the snake_case spellings.

### ⚠ History is not migrated

The fix is forward-only. The poisoned empty-string `rum_apps` row and its tenant attribution
survive; real rows begin appearing alongside it from 3.1.0. **Every `rum_apps` series steps at
this boundary** — split on `sdk.version` before comparing across it. Any saved query or
dashboard filtering on the old camelCase attribute names returns zero rows from this release
onward.

## 3.0.1

First published release of the scoped `@nathanclaire/edge-telemetry-sdk`. (3.0.0 was pulled
from the registry before general availability; npm reserves that version number, so v3 ships
as 3.0.1 — same contract, no functional difference.)

**Breaking wire change.** v3 conforms to the shared EdgeRum / EdgeTelemetryProcessor
contract — the same backend the web, Android (Ionic) and iOS SDKs feed. The v2 wire
format is removed, not flag-gated (single clean break, no dual-emit). Upgrade deliberately,
once.

### Breaking

- **Package renamed.** Published as **`@nathanclaire/edge-telemetry-sdk`** (scoped under the
  org), replacing the unscoped `edge-telemetry-sdk` (last at 2.1.0, now deprecated). Update
  your install and imports:
  `npm install @nathanclaire/edge-telemetry-sdk` /
  `import { createTelemetry } from "@nathanclaire/edge-telemetry-sdk"`.
- **`apiKey` is now required.** `createTelemetry({ apiKey, endpoint, ... })` — the key must
  start with `edge_`; init throws otherwise. Sent as the `X-API-Key` header. `tenant_id` is
  never sent (the backend resolves the tenant from the key).
- **Batch envelope.** The POST body is now
  `{ type: "telemetry_batch", timestamp, batch_size, events }` POSTed to the `endpoint` you
  configure — no longer a bare `{ events }` array.
- **ISO-8601 timestamps.** Event and batch `timestamp` are ISO-8601 strings (was ms epoch).
- **ID formats.** `device_{ms}_{16hex}_{os}`, `session_{ms}_{16hex}_{os}` (suffix = device
  OS), `user_{ms}_{16hex}` (no suffix). 16 hex chars of entropy (was 8, no suffix).
- **Context-as-attributes.** Device/network/app/session/user/sdk data now rides as a flat,
  dot-namespaced Context block on **every** event and metric. The standalone `device_info`
  and `network_info` events are removed.
- **Event renames + allowlist.** `network_request`→`http.request`,
  `network_info_change`→`network_change`, `screen_view`/`screen_end`→`navigation` +
  `screen.duration`, `frame_drop`→`frame_render_time`. Only the 12-name allowlist ships; any
  other `log()` name rides as `custom_event` with the original name in `event.name`.

### Added

- Unified `app.crash` with a `cause` discriminator and `crash.breadcrumbs` (last 20 actions).
- Session lifecycle: `session.started` / `session.finalized`, 30-minute idle rotation, and
  `session.sequence` (incremented per acknowledged batch).
- `app_lifecycle` events on foreground/background transitions.
- `identify()` → `user.profile.update`, attaching `user.name`/`email`/`phone` while
  preserving the anonymous `user.id`.
- Native metrics: `memory_usage` and `frame_render_time`.
- Best-effort native `user.interaction` (tap) events — spread `await telemetry.interactionProps()`
  on your app root `<View>`.
- `debug` option (default `false`) — gates all SDK-internal console output so v3 doesn't spam
  the host app's logs. Set `createTelemetry({ debug: true })` to see diagnostics.

### Preserved

- Retry with backoff + persisted replay of failed batches (AsyncStorage native /
  localStorage web), replayed on next init.

### Migration

1. Add `apiKey` (starting with `edge_`) to `createTelemetry`.
2. Set `endpoint` to the **full** collector URL, e.g.
   `https://collector.example.com/telemetry` — it is used verbatim as the POST URL.
3. Drop any consumer code that read the standalone `device_info`/`network_info` events; that
   data now rides on every event's `attributes`.
4. If you called `log()` with custom names, they now arrive as `custom_event` with your name
   in `event.name`.
