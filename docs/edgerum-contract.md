# EdgeRum wire contract — RN v3 target (reconciled)

Reconciled from three sources after reviewing the iOS sibling SDK:

- **Event/metric names** are frozen to the **EdgeRum Data Capture Reference** (June 2026) —
  these are already supported at the backend. RN does not invent new names.
- **Envelope + identity + structure** follow the **iOS canonical contract**
  (`edge_telemetry_ios_sdk/CLAUDE.md` — "EdgeTelemetryProcessor contract"), the newest and
  strictest sibling. RN-native is native, like iOS.
- The original Angular payload (`edge_telemetry_ionic_angular_demo_app/http.json`) is the
  **older/looser** shape; fields it carries that iOS dropped are NOT replicated (see below).

Anything RN adds beyond what the backend already handles is tracked in
[backend-additions-ledger.md](backend-additions-ledger.md) for later backend wiring.

---

## POST body (batch envelope) — iOS-clean

```jsonc
POST /collector/telemetry
X-API-Key: edge_...                          // value MUST start with "edge_"

{
  "type": "telemetry_batch",
  "timestamp": "2026-06-14T10:30:00.512Z",   // ISO 8601 with fractional seconds, never ms
  "location": "Nairobi/Kenya",               // OPTIONAL (config or runtime-resolved); omit if unset
  "batch_size": 13,                          // == events.count
  "events": [ /* Event | Metric */ ]
}
```

- **No `tenant_id`** — backend resolves it from the API key.
- **No `sdk.contract_version`** anywhere — Ionic-only field, dropped.

## Event vs Metric

```jsonc
{ "type": "event",  "eventName":  "http.request", "timestamp": "<ISO>", "attributes": { ... } }
{ "type": "metric", "metricName": "long_task", "value": 60, "timestamp": "<ISO>", "attributes": { ... } }
```

- `timestamp` ISO 8601 string. No top-level `userId`/`sessionId` — identity is in `attributes`.
- **Strict allowlist**: an `eventName`/`metricName` not in the lists below is dropped by the
  backend. `custom_event` carries the caller's name as `event.name`.

## eventName allowlist (12) — from the reference doc, matches iOS

`session.started` · `session.finalized` · `app_lifecycle` · `page_load` · `navigation` ·
`screen.duration` · `http.request` · `user.interaction` · `network_change` ·
`user.profile.update` · `custom_event` · `app.crash`

## metricName allowlist

`resource_timing` · `frame_render_time` · `memory_usage` · `long_task` ·
Web Vitals (`LCP` `FCP` `CLS` `INP` `TTFB`) · custom timings (`EdgeRum.time().end()`)

> `page_load`, `resource_timing`, `long_task`, Web Vitals are DOM/PerformanceObserver-based →
> **RN-Web build only**, never native (ADR-0004).

## ID formats (iOS-canonical)

| ID | Format | Notes |
|---|---|---|
| `device.id`  | `device_{ms}_{16hex}_{os}`  | suffix = **device OS** (`ios`/`android`), not the framework |
| `session.id` | `session_{ms}_{16hex}_{os}` | same |
| `user.id`    | `user_{ms}_{16hex}`         | **no** suffix; SDK-owned anonymous id |

`{16hex}` = 64 bits of entropy. Regex: `^(session|device|user)_\d+_[0-9a-f]{16}(_(ios|android))?$`.
`identify()` attaches host-app identity as `user.name/email/phone` attrs — it does NOT change `user.id`.

## Identity attributes on EVERY event/metric (iOS-clean set)

```
app.name, app.version, app.package_name, app.build_number, app.environment
device.id, device.platform (ios|android), device.model, device.manufacturer, device.os,
  device.platform_version, device.isVirtual, device.screenWidth, device.screenHeight,
  device.pixelRatio, device.batteryLevel, device.batteryCharging
network.type, network.effectiveType
session.id, session.start_time (ISO), session.sequence
user.id  (+ user.name / user.email / user.phone after identify())
sdk.version, sdk.platform = "react-native"
```

**Dropped vs the Angular payload** (do not emit): `sdk.contract_version`,
`session.is_first_session`, `session.total_sessions`, `network.connected`, `network.downlinkMbps`.
`sdk.platform = "react-native"` is a **new value** — needs the same backend sign-off the iOS team got for `ios-native`.

## Per-event attribute shapes

Backend already handles the reference-doc captures. Where RN emits **richer** attributes than
the reference doc lists, those keys are additive and tracked in the additions ledger.

| name | type | attributes (reference-doc baseline → RN may add) |
|---|---|---|
| `navigation` | event | `navigation.from_screen`/`to_screen`/`method`/`route_type` (React Navigation). iOS uses `navigation.screen`/`previous_screen`/`type`/`kind` — pick the backend's keyed set; **confirm before pinning** |
| `screen.duration` | event | `screen.name`, `screen.duration_ms`, `screen.exit_method` |
| `http.request` | event | baseline `http.url`/`method`/`status_code`/`duration_ms`/`success`; **additive**: `http.host`/`path`/`request_size`/`response_size`/`from_cache` |
| `network_change` | event | `network.previous_type` + current `network.*` |
| `app.crash` | event | `cause` discriminator + `crash.breadcrumbs` (last 20, JSON string) + `crash.report_*` |
| `session.started`/`finalized` | event | finalized carries journey summary + `sdk.error_count`; immediate flush |
| `app_lifecycle` | event | foreground/background transition |
| `user.interaction` | event | native: best-effort taps (no DOM `target_tag`/`target_class`) |
| `user.profile.update` | event | from `identify()` |
| `custom_event` | event | caller name in `event.name` |
| `resource_timing` | metric | `resource.*` (iOS) — web-only on RN |
| `frame_render_time` | metric | `frame.max_ms`/`p95_ms`/`dropped_count`/`target_hz`/`source` |
| `memory_usage` | metric | platform memory snapshot |

## Open per-event reconciliations (confirm with backend before pinning)

- `navigation`: reference-doc/Angular `from_screen/to_screen/method/route_type` vs iOS
  `screen/previous_screen/type/kind`. Which does the backend dashboard on?
- `resource_timing`: Angular `metric.*` vs iOS `resource.*` namespace.
- `sdk.platform = "react-native"` acceptance.
