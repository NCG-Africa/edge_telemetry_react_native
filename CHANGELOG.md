# Changelog

All notable changes to `@nathanclaire/edge-telemetry-sdk` are documented here.

## Unreleased

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
  dependency that was never imported; it is a no-op wherever `crypto` already exists.

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
