# @nathanclaire/edge-telemetry-sdk (React Native)

RUM SDK for React Native apps. Captures performance, errors, network, device/navigation
context and ships it to the shared EdgeTelemetryProcessor backend — the same backend the
Ionic/Angular and iOS SDKs feed. v3 brought this repo onto that backend's wire contract.

This file is the shared vocabulary. Code, commits, issues and docs use these words and avoid
the listed alternatives. Behaviour lives in `CLAUDE.md`; ground truth with `file:line`
citations lives in `sdk-audit.yaml`.

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
The App/Device/Network/Session/User/SDK attributes merged into *every* event and metric by
`collectContext()`. In v3 this is the only way device/network data reaches the backend —
there are no standalone `device_info`/`network_info` events.
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
The framework identity — the constant `react-native` for this SDK, on both builds.
Distinct from **device.platform**, the OS (`ios`/`android`/`web`), which also forms the
`device.id`/`session.id` suffix on native.
_Avoid_: conflating with device.platform or os

**Web-only metric**:
A metric only meaningful in a DOM/PerformanceObserver runtime (Web Vitals, `page_load`,
`resource_timing`, `long_task`). Allowlisted but **not yet emitted** — the RN-Web track.
_Avoid_: performance metric (too broad)

**Breadcrumb**:
One of the last 20 event names + timestamps, kept in the `BreadcrumbBuffer` ring and
attached to `app.crash` as `crash.breadcrumbs` (JSON-stringified). Context for *why* a
crash happened.
_Avoid_: trail, history, log

**cause**:
The discriminator on `app.crash`, shipped as `crash.cause`: `Error`,
`UnhandledRejection`, `ConsoleError`, `ConsoleWarn`. All crash-like signals funnel into one
`app.crash` event keyed by cause — there is no separate error event.
_Avoid_: error type, kind, category

**Session**:
A continuous usage span. Bounded by `session.started` / `session.finalized`, rotates after
30 min idle (and on background→foreground on native), carries `session.start_time` and
`session.sequence` (incremented per acknowledged batch).
_Avoid_: visit, run

**Debug gate**:
`debug()` in `core/debug.ts` — the only sanctioned way to log from SDK internals, silent
unless the consumer passes `debug: true`. Bare `console.log` in `src/` is a defect.
_Avoid_: logger, verbose mode

**Audit**:
`sdk-audit.yaml` — the generated, citation-backed description of what the SDK actually
emits and does today, including its known gaps. Update it in the same commit as any
behaviour change.
_Avoid_: spec, docs (it describes, it does not prescribe)
