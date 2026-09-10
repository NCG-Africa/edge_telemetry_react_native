# @nathanclaire/edge-telemetry-sdk (React Native)

RUM SDK for React Native apps. Captures performance, errors, network, device/navigation
context and ships it to the shared EdgeTelemetryProcessor backend — the same backend the
Ionic/Angular and iOS SDKs feed. v3 brought this repo onto that backend's wire contract; v4
adds the View entity, the trace/span surface and the error-surface re-cut on top of it.

This file is the shared vocabulary. Code, commits, issues and docs use these words and avoid
the listed alternatives. Behaviour lives in `CLAUDE.md`, which is the single source of truth;
the wire keys themselves are pinned by `docs/backend-wire-contract.md`.

## Language

**Batch envelope**:
The POST body. `{ type: "telemetry_batch", timestamp, batch_size, events }`, built by
`adapters/batch.ts`. The unit of shipping — never send a bare event array.
_Avoid_: payload, request body

**Event**:
A discrete thing that happened (`http.request`, `navigation`, `app.crash`). Carries
`eventName` + `attributes`.
_Avoid_: log entry, record

**Metric**:
A numeric measurement (`frame_render_time`, `memory_usage`). Carries `metricName` + numeric
`value` + `attributes`. Distinct from Event by the `type` field, not by name.
_Avoid_: gauge, measurement, data point

**Context block**:
The App/Device/Network/Session/User/View/SDK attributes merged into *every* event and metric
by `collectContext()`. **Frozen at 39 keys** (contract §3.3); a key the SDK has nothing for is
*omitted from the bag*, never shipped as an explicit null. It is the only way device/network
data reaches the backend — there are no standalone `device_info`/`network_info` events.
_Avoid_: metadata, tags, common fields

**Attributes**:
The flat, dot-namespaced bag on each event/metric (`http.url`, `device.model`,
`session.id`). Values stay primitive; nested objects are flattened with dot keys.
_Avoid_: properties, payload, fields

**Event allowlist**:
`ALLOWED_NAMES` in `core/telemetry.ts` — the fixed set of names the backend routes.
Anything else is dropped on ingest, so the SDK rewrites unknown names to `custom_event`
carrying the original as `event.name`. Names are frozen to the EdgeRum Data Capture
Reference; adding one needs backend sign-off.
_Avoid_: event types, event registry

**sdk.platform**:
The framework-OS compound — `react-native-ios` / `react-native-android` / `react-native-web`,
joining Flutter's `flutter-{os}` shape. ⚠ **Not** a closed three-value enum: RN-Windows would
emit `react-native-windows`. Distinct from **device.platform**, the bare OS
(`ios`/`android`/`web`), which also forms the `device.id` / `session.id` suffix.
_Avoid_: conflating with device.platform or os; the bare `react-native` (that was v3)

**View**:
v4's screen entity, owned by `adapters/viewManager.ts` and shared by both builds. A `view.id`
+ `view.name` ride the Context block of every row, and one `view` event is emitted at **exit**.
It has **four lifetime boundaries and nothing else**: route change, background, session
rotation, process death — so a `view.id` **never spans a `session.id` and never spans a
process**, and one screen visit can produce several `view` rows (sum by `view.name`). Supersedes
v3's `screen.duration` / `navigation` pair, which stay only as deprecated native feeds.
_Avoid_: screen, page, route (those name the *thing*; View names the SDK's bounded lifetime)

**rung**:
A level on a *name ladder* — the ranked list of sources a name is derived from, where **rank
beats arrival order**. Two ladders exist: `view.name`'s **three** naming rungs (`explicit` >
`route` > `url`, reported as `view.name_source`) and `ui.interaction`'s **five** (`edge_action` >
`test_id` > `aria_label` > `title` > `text`, reported as `ui.name_source`). Both report `none`
when nothing survived; `none` is the floor, not a rung. A **higher** rung
re-stamps the name in place — an *upgrade*, not a navigation, so `view.id` does not move; a
**lower** one is ignored outright, whenever it arrives.
_Avoid_: priority, fallback, precedence level

**Action**:
One user-caused unit of work and everything it set off — a tap, a route change, a launch, a
bare request. Its envelope is a `GROUP BY rum.action.id`, never a self-join, because
**`rum.action.id` is the root's `span.id`** (`== span.id` on a root, `== parent.span.id` on a
child). An action genuinely **may outlive its View**: one `rum.action.id` spanning two
`view.id`s is correct, not a defect.
_Avoid_: user journey, flow, transaction

**root**:
The span an Action is named by, and the *live* one is held in a single **carrier** field on the
`Telemetry`-owned `TraceManager` — never a module global, never a thread-local. Four things mint
one: `app.start`, once per process in the `Telemetry` constructor and therefore always the first
root (`trace.root_type: launch`); `view` at entry and `http.request` at send, **those two only
when no root is live**; and `ui.interaction`, which mints **unconditionally**, replacing whatever
was live — a tap is a new user action by definition, which is what makes the request a tap fires a
child of the tap rather than of the route change before it. Expires at 2 s idle / 10 s cap, and
background and session rotation both clear it.
_Avoid_: trace, parent, transaction

**span**:
One timed segment inside an Action — `span.id`, `parent.span.id`, `span.start_time`, and
`span.duration_ms` on **Tier 1 children only** (a root's width is derived server-side). ⚠ `view`
carries a start but **never a duration**: view dwell is `view.time_spent`, and a duration would
stretch every tap-that-navigates envelope across the whole time the user sat on the screen.
_Avoid_: segment, timing, operation

**tier**:
How much of the trace surface an event carries. **Tier 1** — span-carrying: `app.start`, `view`,
`http.request`, `ui.interaction`. **Tier 2** — annotation-only (`trace.id`, `rum.action.id`,
`trace.root_type`, no span): `app.crash`, `app.error`, `custom_event`; it **never mints**, so with
no live root it carries no trace keys at all. **Tier 3** — trace-free: *all* metrics, plus
`app_lifecycle`, `network_change`, the session events, `user.profile.update` and the deprecated
feeds. A windowed aggregate belongs to no single Action.
_Avoid_: level, class, category

**outcome ladder**:
An ordered rule set where **the first matching rung wins and the value it stamps is the whole
answer** — precedence is table order, not severity. Two exist: `traceparent.outcome`'s seven
values (§6.5) and `view.loading_time_outcome`'s four (§4.5.2). Both exist so a null or an absence
is *explained* rather than guessed at: `view.loading_time_outcome` always ships precisely because
it tells the null causes apart, and `traceparent.outcome`'s absence means "not traced".
_Avoid_: state machine, enum (both true and both miss the point — the ordering is the contract)

**Web-only metric**:
A metric only meaningful in a DOM/PerformanceObserver runtime — in v4 that is exactly the five
Core Web Vitals (`LCP`, `FCP`, `CLS`, `INP`, `TTFB`), and they *are* emitted. ⚠ `page_load`,
`resource_timing` and `long_task` are **retired, not deferred** (§10.2): their jobs are done by
`view` + `view.loading_time` + the vitals + `frame_render_time`. Build nothing for them.
_Avoid_: performance metric (too broad); calling the three retirements "not yet emitted"

**Breadcrumb**:
One of the last 20 event names + timestamps, kept in the `BreadcrumbBuffer` ring and attached
to `app.crash` as **`error.breadcrumbs`** (a JSON-*stringified* array — `stringAttr` renders a
real array through `fmt.Sprint` as Go map syntax). Context for *why* a crash happened. Rides
`app.crash` **only**: `app.error` volume is consumer-controlled, and a 1–2 KB blob on a
high-volume event spends the transport budget by the SDK's own doing. An opted-in
`console.warn` becomes a breadcrumb rather than an event.
_Avoid_: trail, history, log; `crash.breadcrumbs` (that was v3)

**error.source**:
The provenance discriminator on the error surface: `global_handler`, `unhandled_rejection`,
`cross_origin` (web), `console`, `reported`. ⚠ It is a **re-cut of v3's `crash.cause`, not a
rename** — do not map the old four values (`Error`, `UnhandledRejection`, `ConsoleError`,
`ConsoleWarn`) on positionally. `ConsoleWarn` is deleted outright (a warning is a Breadcrumb
now) and `cross_origin` is new, naming the `"Script error."` case a CDN without CORS headers
produces. Fatality is **not** carried here: the *event name* carries handled-vs-unhandled.
_Avoid_: cause, `crash.cause`, error type, kind, category

**Error surface**:
The pair `app.crash` (unhandled / fatal-ish) and `app.error` (handled / non-fatal) — **two
names, not one**, so crash-free rate is `COUNT(app.crash) / sessions` with no `WHERE` clause.
There is **no public path to `app.crash`**: a consumer's `log("app.crash")` is routed to
`app.error`. All five `crash.*` keys are retired for dotted `error.*`.
_Avoid_: "the crash event" (there are two); error/crash used interchangeably

**Session**:
A continuous usage span. Bounded by `session.started` / `session.finalized`, with **two
rotation boundaries and nothing else**: 30 min idle and a 4-hour maximum length. ⚠ Neither
build rotates on a lifecycle transition any more — v3's native `background → finalize` pair
was deleted to reach parity with web. It survives process death, tab close and reload via the
persisted session record, so a **resumed session re-emits no `session.started`**. Carries
`session.start_time` and `session.sequence` (incremented per acknowledged batch).
_Avoid_: visit, run

**Debug gate**:
`debug()` in `core/debug.ts` — the only sanctioned way to log from SDK internals, silent
unless the consumer passes `debug: true`. Bare `console.log` in `src/` is a defect.
_Avoid_: logger, verbose mode

**Contract**:
`docs/backend-wire-contract.md` — the cross-SDK agreement on every wire key: name, type,
null discipline, cardinality, enum domain. It *prescribes*, and it outranks every other
document here. Changing anything it pins needs backend sign-off first.
_Avoid_: schema, API spec

**Known gaps**:
The section of `CLAUDE.md` listing what this SDK does not do, does partially, or does
deliberately differently — each with its reasoning. Update it in the same commit as any
behaviour change. Not a backlog: several entries are settled trade-offs.
_Avoid_: TODOs, tech debt
