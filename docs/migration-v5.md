# Migrating to v5 — @nathanclaire/edge-telemetry-sdk (React Native)

**Ships with the release, not after it.** v5 has **six breaking changes**. **Exactly one is visible
at compile time** — #1, the entry classes becoming type-only exports. The other five surface at
runtime or in a chart, which is why this note arrives with the release.

`docs/backend-wire-contract.md` is authoritative for every wire key — §12.6 for the notices below,
Appendix B for the sign-off asks. Where it and this note disagree, the contract wins. `CLAUDE.md`
explains the behaviour behind each entry. The source list is #156 §1.

---

## Read this first

- ⚠ **v5 must not ship to production while any of contract Appendix B's A1–A14 is unsigned.** Every
  v5 name and key is already emitted, and an unlisted name or key is **dropped on ingest** — so
  `task.complete` and `app.hang` rows, and every new key below, vanish behind a 2xx until the
  backend signs. See [The backend gate](#the-backend-gate-a1a14).
- **One change breaks a build**: `new TelemetryWeb()` / `new TelemetryNative()` no longer
  compile. Use `createTelemetry()`, which every documented setup already does.
- **Five changes are runtime-only.** No compile error; the one log line any of them produces is
  #6's dev-only rejected-batch warning.
- **Every one is separable only by `sdk.version`** (`5.0.0`), as in v4.
- **Most apps have nothing to change.** Everything v5 adds is additive; `autoTrackTaps` is opt-in, and
  consent gating (`enabled: false`) is too.

---

## Breaking changes (6)

| # | Change | Visible | What breaks | Fix |
|---|---|---|---|---|
| 1 | `TelemetryWeb` / `TelemetryNative` are exported **as types only**; `createTelemetry()` is the only way to build one (#159) | **compile time** | `new TelemetryWeb(...)` / `new TelemetryNative(...)` — a type error, and a runtime `undefined` from untyped JS | `createTelemetry(opts)`. It is what runs the `apiKey` / `traceHostAllowlist` validation the constructor skipped. The types still import for annotations |
| 2 | **`navigation` and `screen.duration` are removed from the wire**; `screenEnd()` and `trackRoute()` become `@deprecated` no-ops, deleted in v6. `screenStart()` stays (#163) | chart | both tables stop receiving RN rows; calls to the two no-ops still compile and do nothing | read the `view` event — `view.time_spent` is the dwell, `view.name` the screen. Drop the two calls before v6 |
| 3 | **`view.name` from `attachNavigation` is the route names joined root to leaf with `/`** (#170) | chart | a dashboard keyed on a nested leaf name — `Details` is now `HomeTab/Details`. Top-level screens are unchanged | re-key the panel on the joined name. Under Expo Router you get the file-path template (`(tabs)/settings/index`) with no code beyond `attachNavigation(useNavigationContainerRef())` |
| 4 | **A route change is always a view boundary**, even after `screenStart()` (#169) | chart | an app that called `screenStart()` and then navigated had one long view in v4; it now has one per route, so `view` row counts rise and dwell per row falls | nothing, unless you relied on the pin. Call `screenStart()` from each screen's own effect |
| 5 | `react-native-device-info`, `@react-native-community/netinfo` and `react-native-get-random-values` are **externalized**, not bundled (#158) | runtime | the copy that runs is **your installed one**, not the one we built against. An old `device-info` lacks `supportedAbis` / `isLowRamDevice` / the battery reads, and those keys are then omitted | keep those packages current. Netinfo and get-random-values are still `dependencies`, so npm installs them |
| 6 | **§2.5 status handling and a draining `flush()`** (#162): a 4xx (except 429) drops the batch — no retry, no persist; a 429 requeues and halts until `X-RateLimit-Reset`; `flush()` drains up to 50 batches | runtime | a wrong `apiKey` used to fill the offline store and stay there; it is now dropped, with one `__DEV__` warning. `flush()` can reject on a 4xx or 429 | check the dev console for the rejected-batch warning — on a 401 it is the **only** signal you get, because the `rejected` count rides a row that never gets through |

---

## Notice only — what an existing series means at the boundary (B1–B5)

None needs backend work. Contract §12.6.

| # | Change | Effect |
|---|---|---|
| B1 | `navigation` / `screen.duration` removed (#2 above) | retires `navigation.from_screen`, the SDK's last explicit wire `null` — **omission is now universal** |
| B2 | joined `view.name` (#3 above) | nested values change; flat apps and Expo Router file paths are stable |
| B3 | `view.action_count` under `autoTrackTaps` | counts every `onPress`/`onLongPress` activation instead of named `trackTap()`s, so **the column's meaning is per app** |
| B4 | `sdk.drop_reason: rejected` gets its first producer (#6 above) | an arrival-shape change only |
| B5 | **consent-gated processes skip `app.start`** | `createTelemetry({ enabled: false })` never emits `app.start` for that process, so `COUNT(app.start)` undercounts launches in consent-gated apps |

Plus: **a web app that never wired `attachNavigation` now emits `view` rows per route.** v4's web
history path never ran, so it emitted no `view` row per route; v5 emits one per `pushState` /
`popstate` route, named by normalized path. More rows, not different ones.

---

## What v5 adds

All additive. Full detail in the [CHANGELOG](../CHANGELOG.md) and `CLAUDE.md`.

| Surface | What |
|---|---|
| `startSpan` / `withSpan` / `endSpan` | manual spans → one `task.complete` row per span, `completed` \| `failed` \| `abandoned` |
| `app.hang` | JS-thread stalls of 2–60 s, foreground only, never under `__DEV__` |
| `<EdgeErrorBoundary>` | a caught render error → `app.error`, `error.source: boundary`, `error.component_stack` |
| `markScreenReady()` / `useScreenReady()` | `view.ready_time` / `view.ready_outcome` on the `view` row; native `app.start.js_ready_ms` |
| `recordMetric` / `addBreadcrumb` / `startNewSession` | parity APIs; `session.reason` gains `manual` |
| `disable()` / `enable()` / `enabled` | consent kill-switch — while disabled nothing is sent and nothing is kept |
| device state | battery on native `app.crash` / `app.error` / `app.hang`; accessibility on `session.started` |
| `autoTrackTaps` | native, opt-in: automatic `onPress` (`tap`) and `onLongPress` (`long_press`) capture |

---

## The backend gate (A1–A14)

v5 ships two new event names and fourteen asks, each needing a sign-off line in contract Appendix B.
**At this release every one is unsigned**, so until each is signed its rows or keys are dropped on
ingest:

| Ask | Affected until signed |
|---|---|
| A1–A3 | `task.complete` rows, `trace.root_type: custom`, `span.duration_ms` on a root |
| A4 | `app.hang` rows — **plus** the processor fix to read dotted `hang.duration_ms` |
| A5–A6 | `error.source: boundary`, `error.component_stack` |
| A7 | `view.ready_time`, `view.ready_outcome` dropped |
| A8 | nothing dropped — confirms `app.start.js_ready_ms` (already on v4's signed `app.start`) is native-only |
| A9 | `session.reason: manual` |
| A10 | `device.battery_level`, `.battery_charging`, `.power_save` |
| A11 | `device.reduce_motion`, `device.screen_reader`, `device.font_scale` |
| A12–A13 | native `ui.name_source: test_id`, `ui.type: long_press` |
| A14 | nothing dropped — the ladder amendment (#4 above) is semantic, no key |

Open rulings C1–C10 (Appendix C) do **not** block: v5 ships the current behaviour for each, and a
ruling that flips one becomes its own ticket.

---

## Departures from the sibling SDKs

New in v5, recorded so the next diff does not file a decision as drift. v4's five departures from
Android (contract §13) all still stand.

| Departure | Sibling | Why |
|---|---|---|
| **`addBreadcrumb(name, data?)`** — no `category`, no `level` | Android, Flutter | the shared ring is debugging context on `app.crash` / `app.hang`, not a log; ≤8 data keys, values capped 255 |
| **`disable()` discards the backlog** — memory queue and offline store | iOS keeps it | an opt-out means nothing sent *and nothing kept*; a backlog held through an opt-out is data kept without consent |
| **`app.hang` is the JS thread only** — no stack, no ANR | Android's main-thread ANR | pure JS: no native module, so by the time anything can look the frozen code has returned |
| ⚠ **`device.screen_reader`, `device.font_scale`, `error.component_stack`** | none — RN inventions | no sibling precedent; their sign-off lines (A6, A11) are decisions, not confirmations |
| **`autoTrackTaps` never reads text or accessibility labels** | — | `"Pay John Kamau KES 5,000"` is what a label rung ships; the ladder is `trackTap` > `testID` > `unnamed` |

---

## Columns RN will never write — what moved

[v4's table](./migration-v4.md#columns-rn-will-never-write) still holds, with these changes:

| Table / columns | v5 |
|---|---|
| `rum_errors.hang_duration_ms` | **now produced** — by `app.hang`'s `hang.duration_ms`, once A4's processor fix lands (NULL for every SDK until then). `anr_duration_ms`, `crash_thread`, `crash_is_main_thread` stay empty: still JS-level only |
| `device.battery_level` / `battery_charging` / `power_save` | **now produced**, native failure rows only (A10). Out of v4's deferred bundle — a JS read through device-info, no native module |
| `rum_navigations` / `rum_navigation_events`, `rum_screen_durations` | **no RN rows on either build** — both feeds are removed (#2) |
| `rum_ui_interactions` `ui_direction` | still empty — swipe, scroll and pinch were ruled out of v5. `ui.type` gains only `long_press` |
| `device.thermal_status`, `device.cpu_cores`, `app.exit`, native signal/ANR capture | still deferred as v4's native-module bundle |

---

## Deprecated, still live

- `screenEnd()` / `trackRoute()` — no-ops since v5, **deleted in v6**.
- The six `UserProfile` fields (`fullName`, `firstName`, `lastName`, `avatar`, `createdAt`,
  `updatedAt`) — still `@deprecated` and still live; their removal is **deferred to v6** rather than
  added to this release's break list. `fullName` still builds `user.name`.

---

## Known gaps

### v5 adds

Each is in `CLAUDE.md`'s Known gaps with its reasoning.

- **Manual spans** — a span outliving the 10 s root cap keeps its root's ids, but later requests mint
  their own root, so a long journey's `rum.action.id` covers only its first ten seconds of requests.
  A superseded span emits nothing.
- **`app.hang`** — no stack, ever; a stall that never ends (the OS kills it) emits nothing; only the
  JS thread is seen; `hang.duration_ms` under-reports by up to one tick.
- **Error boundary** — a thrown non-object is not deduped; on React 18 with `captureConsole` on, a
  caught error can add a `console` row beside the `boundary` one.
- **`view.ready_*`** — a screen's first visit in a process can't be judged `abandoned`; a mark
  landing after a tab-away is lost.
- **Launch counting** — consent-gated processes skip `app.start` (B5).
- **Consent** — `disable()` lasts one process (the host keeps the consent record); a batch already
  in flight still completes.
- **Accessibility** — a mid-session toggle is missed; a resumed session carries its launch's state.
- **Battery** — up to 60 s stale; coverage equals `react-native-device-info` install coverage.
- **`autoTrackTaps`** — non-tap `onPress` callbacks (map markers, libraries) also emit;
  `view.action_count` changes meaning for opted-in apps (B3).

### v5 closes

- `flush()` sent one batch per call — it now drains (#162).
- `sdk.drop_reason: rejected` had no producer — a 4xx now books it (#162).
- web shipped `navigation` with the query string, and emitted `navigation` at all (#163).
- `screenStart()` could pin a view across route changes (#169).
- `apiKey` / allowlist / `sdk.platform` validation could be bypassed with `new` (#159).
- the vitals tracker kept running after `shutdown()` (#160).
- shared `trackErrors()` imported the native crash handler (#160).
- web tabs diverged on the shared session record (#161).
- a synchronously-throwing XHR `send()` left its `request` root live (#160).
- `app.start.js_ready_ms` was specified and not built (#171).
- on React ≤18 web dev builds, a boundary-caught error also shipped as `app.crash` — React's dev
  replay reaches `window.onerror` before the boundary marks it (#175).
