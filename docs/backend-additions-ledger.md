# Backend additions ledger — RN v3

Running list of everything the RN SDK introduces **beyond what the backend already handles**
(per the EdgeRum Data Capture Reference + iOS contract). Hand this to the backend team so each
addition gets wired up. Nothing here should block RN development — emit it, document it here.

Status legend: `proposed` (RN will emit, backend not yet handling) · `confirmed` (backend acked) · `live`.

## New identity / envelope values

| Item | What | Status |
|---|---|---|
| `sdk.platform = "react-native"` | New framework value, like iOS's `ios-native`. Backend must accept it for dashboards/filters. | proposed |
| ID suffix `_android` from RN | RN-on-Android emits `device_…_android` / `session_…_android` (same as Ionic-on-Android). RN-on-iOS emits `_ios`. Confirm both route. | proposed |
| RN-Web build IDs have **no** OS suffix | The contract suffix is `ios`/`android` only; the web build omits it (`device_…_{16hex}`). `device.platform="web"` still rides as an attribute. Confirm suffix-less ids route. | proposed |

## Transport deviations

| Item | What | Status |
|---|---|---|
| Web uses `fetch({keepalive:true})`, not `sendBeacon` | `navigator.sendBeacon` cannot set the required `X-API-Key` header, so the web sender uses `fetch` with `keepalive` to preserve unload-survival. No backend impact (same POST body/headers); recorded for completeness. | n/a |

## New / richer event attributes (additive — baseline keys unchanged)

| Event | Added keys | Why | Status |
|---|---|---|---|
| `http.request` | `http.host`, `http.path`, `http.request_size`, `http.response_size`, `http.from_cache` | Richer than reference-doc baseline; matches iOS. | proposed |
| `app.crash` | `crash.breadcrumbs` (last 20 actions, JSON string), `crash.report_*` | Crash context. Confirm size cap. | proposed |
| `frame_render_time` | `frame.max_ms`, `frame.p95_ms`, `frame.dropped_count`, `frame.target_hz`, `frame.source` | Aggregated frame window (iOS shape). | proposed |

## Open reconciliations (pick the backend-keyed shape before RN pins it)

| Event | Option A (Angular/reference) | Option B (iOS) | Decision |
|---|---|---|---|
| `navigation` | `navigation.from_screen/to_screen/method/route_type/has_arguments` | `navigation.screen/previous_screen/type/kind` | RN emits Option A baseline (#26); _pending backend_ |
| `resource_timing` | `metric.unit/resource_name/resource_type/transfer_size` | `resource.url/host/dns_ms/connect_ms/tls_ms/ttfb_ms/download_ms` | _pending backend_ |

## Notes

- RN-native does NOT emit web-only signals (`page_load`, `resource_timing`, `long_task`,
  Web Vitals) — those are RN-Web-build only (ADR-0004). Not an "addition", a platform fact.
- Anything added during implementation that isn't in the reference doc → add a row here.
