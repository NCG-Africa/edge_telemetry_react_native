# @nathanclaire/edge-telemetry-sdk (React Native)

RUM SDK for React Native apps. Captures performance, errors, network, device/navigation
context and ships it to the shared EdgeTelemetryProcessor backend — the same backend the
Ionic/Angular SDK feeds. v3 brings this repo onto that backend's wire contract.

## Language

**Batch envelope**:
The POST body. `{ type: "telemetry_batch", timestamp, batch_size, events }`. The unit of
shipping — never send a bare event array.
_Avoid_: payload, request body

**Event**:
A discrete thing that happened (`http.request`, `navigation`, `app.crash`). Carries
`eventName` + `attributes`.
_Avoid_: log entry, record

**Metric**:
A numeric measurement (`long_task`, `frame_render_time`). Carries `metricName` + numeric
`value` + `attributes`. Distinct from Event by the `type` field, not by name.
_Avoid_: gauge, measurement, data point

**Context block**:
The App/Device/Network/Session/User/SDK attributes merged into *every* event and metric.
In v3 this is the only way device/network data reaches the backend — there are no
standalone `device_info`/`network_info` events.
_Avoid_: metadata, tags, common fields

**Attributes**:
The flat, dot-namespaced bag on each event/metric (`http.url`, `device.model`,
`session.id`). Values stay primitive; nested objects are flattened with dot keys.
_Avoid_: properties, payload, fields

**Event allowlist**:
The fixed 12 `eventName`s the backend routes (`navigation`, `http.request`, `app.crash`, …);
anything else is dropped on ingest. Names are frozen to the EdgeRum Data Capture Reference.
Custom names ride inside `custom_event` as `event.name`.
_Avoid_: event types, event registry

**sdk.platform**:
The framework identity — `react-native` for this SDK (a new value, like iOS's `ios-native`).
Distinct from **device.platform**, the OS (`ios`/`android`/`web`) which also forms the
`device.id`/`session.id` suffix. One `sdk.platform` per build regardless of device.
_Avoid_: conflating with device.platform or os

**Additions ledger**:
`docs/backend-additions-ledger.md` — the running list of attributes/values RN emits beyond
what the backend already handles, so each can be wired up backend-side later.
_Avoid_: backlog, TODO

**Web-only metric**:
A metric only meaningful in a DOM/PerformanceObserver runtime (Web Vitals, `page_load`,
`resource_timing`, `long_task`). Emitted by the RN-Web build only — never by native.
_Avoid_: performance metric (too broad)

**Breadcrumb**:
One of the last 20 user/app actions, kept in a ring buffer and attached to `app.crash` as
`crash.breadcrumbs` (JSON-stringified). Context for *why* a crash happened.
_Avoid_: trail, history, log

**cause**:
The discriminator on `app.crash` (`Error`, `ConsoleError`, `NativeCrash`, `ANR`, `Hang`,
…). All crash-like signals funnel into one `app.crash` event keyed by `cause`.
_Avoid_: error type, kind, category

**Session**:
A continuous usage span. Bounded by `session.started` / `session.finalized`, rotates after
30 min idle, carries `session.start_time` + `session.sequence` (incremented per ACKed batch).
_Avoid_: visit, run
