# Migrating to v4 — @nathanclaire/edge-telemetry-sdk (React Native)

**Ships with the release, not after it.** **Exactly one of the twenty discontinuities below is
visible at compile time** — #2, the accessor return shapes. (The six `@deprecated` `UserProfile`
fields are the other compile-time-visible change, but they are **not one of the twenty**; they sit
outside the list, which is why the table below numbers them `—`.) The remaining **nineteen**
surface at runtime or in a chart — which is exactly why this note has to arrive with the release
rather than trailing it.

`docs/backend-wire-contract.md` §12 is authoritative for this list; where it and this note
disagree, the contract wins. `CLAUDE.md` explains the behaviour behind each entry.

---

## Read this first

- **Two changes break a build.** #2 (accessor return shapes) and the six `@deprecated`
  `UserProfile` fields — the latter outside the twenty. Both are compile-time visible; fix them
  and your app builds.
- **Nineteen changes break a chart** — every entry of the twenty except #2. No compile error, no
  runtime error, no log line: a saved filter quietly returns zero rows, or a series steps at the
  release boundary.
- **Every one of them is separable only by `sdk.version`.** ⚠ That key is absent from the bag on
  essentially all historical rows, so splitting a *historical* series on it does not work.
  Promoting it going forward is the only version of this that does.
- **One action item for most consumers:** if you called `setUserProfile()`, `setUserDetails()`,
  `updateUserProfile()`, `setUserName()` or `setUserContact()` and never called `identify()`,
  your profile data now reaches the wire **not at all** — those five record state, and only
  `identify()` emits `user.profile.update`. Add one `identify()` call. See #6.

---

## Compile-time visible (2)

| # | Change | What breaks | Fix |
|---|---|---|---|
| 2 | `getDeviceInfo()` / `getNetworkInfo()` return shapes changed | destructuring the old camelCase keys | read the new snake_case shape; the `DeviceInfo` type is not importable, so this is structural only |
| — | Six `UserProfile` fields are `@deprecated` (live until v5) | `fullName`, `firstName`, `lastName`, `avatar`, `createdAt`, `updatedAt` warn | `fullName` still works and still builds `user.name`; the other five have no wire key and no reader — drop them |

---

## Shipped in 3.1.0, ahead of v4 (3)

| # | Change | Effect |
|---|---|---|
| 1 | Seven camelCase Context keys respelled to snake_case | any bag query on the old spellings returns **zero rows**; five columns start filling; every `rum_apps` series **steps** here |
| 2 | `getDeviceInfo()` / `getNetworkInfo()` return shapes change | **compile-time visible** — the map's first consumer API break |
| 3 | `app.packageName` → `app.package_name` | stops an active cross-tenant corruption; does **not** migrate history |

---

## v4 — keys that disappear (6)

| # | Change | Effect |
|---|---|---|
| 4 | **`http.url` removed** | ⚠ empties `rum_http_requests.url`, a populated production column in the 2nd most-queried table. Replaced by `http.host` + `http.route` — **not** a query-strip; the identifier lives in the path |
| 5 | **`http.path` removed** | not a rename a `COALESCE` papers over — raw values vs normalized templates |
| 6 | `user.name` / `user.email` / `user.phone` leave the Context block | any bag query filtering **events** on them returns zero rows; they ride `user.profile.update` **only**, and only when you call `identify()` |
| 7 | Six `user.*` wire keys vanish outright | `fullName`, `firstName`, `lastName`, `avatar`, `createdAt`, `updatedAt` |
| 8 | `device.iosDeviceName` vanishes | PII removal. `device.fingerprint` goes with it — see #20 |
| 9 | **Web loses `memory_usage` entirely** | the metric's presence was browser detection wearing a memory label (`performance.memory` is Chromium-only). `TelemetryWeb` has no `trackMemoryUsage` method at all |

---

## v4 — values that change under an unchanged key (7)

These are the dangerous ones: the key still exists, the query still runs, the number is different.

| # | Change | Effect |
|---|---|---|
| 10 | `sdk.platform`: `react-native` → `react-native-{Platform.OS}` | ⚠ a saved filter on `sdk.platform = 'react-native'` returns **zero rows** — the worst way for a chart to fail. ⚠ **Not** a closed three-value enum: `ios` / `android` / `web` are what the two builds emit today, but RN-Windows would emit `react-native-windows` |
| 11 | `memory.type`: `"heap"` → `"rss"` | ⚠ on a **promoted column**, with real v3 Hermes data to be silently compared against. RSS counts native allocations — images, native views — which are what actually get a process OOM-killed |
| 12 | `http.request_size`: UTF-16 units → **UTF-8 bytes** | any non-ASCII traffic's payload-size series steps up **2–3×** |
| 13 | `session.id` gains a `_web` suffix on the web build | value shape changes; nothing parses it |
| 14 | `error.source` re-cuts `crash.cause` | ⚠ a **migration table, not a rename** — do not map the four old values on positionally. `ConsoleWarn` is deleted (a warning is a breadcrumb); `cross_origin` is new. All five `crash.*` keys become dotted `error.*` |
| 15 | `http.method` uppercased | a saved filter on `'post'` returns zero rows — a **correction** |
| 16 | `frame.dropped_count` values move on 90/120 Hz devices | a **correction**: v3 budgeted against a hardcoded 60 Hz and undercounted. `frame.target_fps` is now measured; `frame.target_hz` is gone |

---

## v4 — counts that step (4)

| # | Change | Effect |
|---|---|---|
| 17 | **Session counts drop sharply** | resume-across-process-death replaces per-launch minting, and RN native processes are killed constantly. A resumed session emits **no** `session.started`, so count launches from `app.start`, not from `session.reason` |
| 18 | **Every native device gets a new `device.id`** | device counts double across the boundary **once**, with no v3↔v4 device join available. `device.id` is now SDK-minted and never rotates |
| 19 | **`user.id` vanishes from anonymous traffic** | any "users" chart that does not filter drops to the **identified population**. `COUNT(DISTINCT device.id)` is anonymous reach; `COUNT(DISTINCT user.id)` is known-user reach |
| 20 | **RN-Android device counts step up** | previously-merged handsets un-merge as `device.fingerprint` stops being sent — a **correction** of a real undercount, and the only entry where the v3 numbers were wrong in that direction |

---

## Arrival changes, not content changes

Not counted among the twenty, but they change what ingest sees:

- **Burst arrival**, ~25×-larger and 3×-rarer POSTs (`batchSize` 50 / 30 s).
- **At-least-once duplicates** until the `(session_id, event_sequence)` dedup index exists. ⚠ This
  is a **rollout-ordering question**: the index should land **before or with** the SDK. Until it
  does, replay inflates every aggregate.
- Two volume moves that are not breaks but will look like incidents: `http.request` goes **zero →
  everything** for axios-based tenants (native now patches XHR, the one chokepoint axios uses), and
  `screen.duration` volume goes **up** for React Navigation consumers at the exact moment it is
  deprecated.

---

## Four event names retired

⚠ **Instructions, not omissions.** These are off the allowlist and unreachable — a `log()` call
using one is rewritten to `custom_event`. Build nothing for them.

| Name | Why it is gone |
|---|---|
| `user.interaction` | superseded by `ui.interaction` (§4.6). Android's own contract already says not to build a table for it |
| `page_load` | its job is done three times over: *a page load happened* → `view` with `view.load_type: initial_load`; *how long* → `view.loading_time`; *why slow* → TTFB/FCP/LCP with the phase splits |
| `resource_timing` | per-asset rows: hundreds per asset-heavy view, in a namespace with no column, on one platform of four. A single such view would exceed the 500-event in-memory queue on its own |
| `long_task` | `PerformanceLongTaskTiming` and `long-animation-frame` are **both Chromium-only**, so a "bare `longtask` fallback" buys Chrome 58–122, not one non-Chromium user. Jank detection is already universal via `frame_render_time`; the user-visible consequence is measured by INP's phase split |

The last three were **allowlisted but never produced**, so they add nothing to the migration
story — no chart exists on any of them.

---

## Columns RN will never write

So nobody builds an ANR panel that shows an empty slice forever. Contract §10.1/§10.3.

| Table | Columns | Why |
|---|---|---|
| `rum_crash_events` / `rum_errors` | `anr_duration_ms`, `hang_duration_ms`, `crash_thread`, `crash_is_main_thread` | crash capture is **JS-level only**. A signal handler has no JS `Error` to derive `error.*` from and cannot read the trace carrier |
| `rum_crash_events` | `error_context`, `product_id`, `error_code`, `user_action`, `severity_level` | Android's positional `trackError` overloads. RN ships one method — `captureError(err, context)` — and `context` carries them at no fixed spelling |
| `rum_crash_events` | `crash_hash` | ⚠ `NOT NULL` with no producer, **by design** — backend-computed. No fingerprint ships on the wire: grouping algorithms change, which is a backfill server-side and an app-store rollout SDK-side |
| `rum_ui_interactions` | `ui_direction` | `ui.type` is closed at `click` \| `tap`. Gesture capture is out of scope — do not size this column for RN |
| `rum_ui_interactions` | `ui_screen` | dropped deliberately; `view.name` on the Context block supersedes it |
| `rum_screen_durations` | every row, **on web** | web has never emitted `screen.duration` and will not |
| `rum_sessions` | `duration_ms`, `event_count`, `metric_count`, `screen_count`, `visited_screens`, `is_first_session`, `total_sessions` | all derived server-side |
| `rum_performance_events` | `memory_usage_mb`, `memory_pressure_level`, `memory_timestamp` | RN emits `memory_usage` on the **metric** path; these live on the **event** path |
| `rum_performance_metrics` / `rum_performance_events` | `frame_build_duration_ms`, `frame_raster_duration_ms`, `frame_type`, `frame_dropped`, `frame_total_duration_ms`, `frame_severity` | a model difference, not a spelling one |
| `rum_devices` | `fingerprint` | **deliberately stopped** — zero analytics readers, and sending it corrupts device identity |
| `rum_navigations` / `rum_navigation_events` | `has_arguments` | not adopted; `navigation` is deprecated anyway |
| `rum_trace_spans`, `rum_user_actions` | **every column** | RN writes neither table. The trace surface lands on `rum_telemetry_events` and `rum_http_requests` |
| — | any `resource.*` / `long_task` key, `metric_name = 'page_load'` | retired above |

**Plus the 35 allowlist keys `extract.go` reads that RN never sends** — the largest single group of
empty columns, and the one most likely to be mistaken for a capture bug. Enumerate them with the
command in contract Appendix A; every one stays NULL for RN traffic.

**Deferred as one bundle, not refused:** `device.cpu_cores`, `device.thermal_status`,
`device.battery_level`, `device.battery_charging`, `device.power_save`, `app.exit` and its keys,
native signal/ANR/hang capture, and a synchronous crash store. The rule is that **anything needing
the SDK's first native module defers and is priced against the whole native surface** — Kotlin and
Swift sources in a repo whose CI runs only `npm ci`, a TurboModule spec, and an Expo config plugin,
without which Expo Go consumers cannot install a package that is pure JS today.

⚠ **The JS dirty-flag approximation of `app.exit` is rejected on the record** and must not come
back as the cheap win: it detects abnormal termination without naming the cause, and on mobile the
dominant cause is the user force-quitting, which is not a fault. The metric would not be thin — it
would **invert**, scoring healthy apps with engaged users worst.

---

## Five deliberate departures from Android

RN adopts Android's key names wherever the concept already exists — `trace.*`, `span.*`,
`rum.action.id`, `traceparent.outcome`, `navigation.*`, `screen.*`, `ui.*`, the bag-first storage
model and the promotion rule. These five diverge **on purpose**. Recorded here so the next person
diffing the two SDKs does not file a decision as drift. Contract §13.

| # | Departure | The argument in one line |
|---|---|---|
| 1 | **`error.*` dotted, not Android's undotted `message` / `cause` / `is_fatal`** | RN's bag is one flat namespace shared with 124 keys and `log()` flattens caller data into it, so `message` and `cause` would collide with userland |
| 2 | **`sessionSampleRate`, not Android's `traceSampleRate`** | Android's is per-*trace* and pinned at `1.0`; a per-trace sampler produces orphan children |
| 3 | **`http.route`, not a normalized `http.path`** | one column, two dialects, and nothing in the data to separate them |
| 4 | **`user.id` omitted on anonymous traffic; `device.id` carries anonymous identity** | Android mints both ids the same way into the same store, so its two columns carry one fact. The departure is in *naming*, not storage |
| 5 | **`user.*` profile keys leave the Context block for `user.profile.update`** | Android persists its profile; RN's is in-memory, and shipping PII on every event to fill a table that needs it once is indefensible |

Smaller stated divergences, each in place: `injected_unwired` dropped; `b3` declined; hostname
matching ignores the port while `http.host` keeps it (**do not join them**); allowlist validation is
`__DEV__`-gated rather than an unconditional `require`; malformed consumer `traceparent` headers are
left alone rather than repaired; `ui.screen` dropped; `error.handled` dropped; breadcrumb cap 20
against Android's 50; `app.start.js_ready_ms` rather than `duration_ms`.
