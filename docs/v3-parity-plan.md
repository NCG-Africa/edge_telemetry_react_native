# v3.0.0 — EdgeRum parity plan (React Native)

Goal: RN data lands in the shared EdgeTelemetryProcessor backend on the canonical contract.
Single clean cutover (ADR-0001). Scope = **full native parity**. Contract is **reconciled on
the iOS shape with names frozen to the reference doc** (ADR-0005); additive attributes go in
the [additions ledger](backend-additions-ledger.md).
Spec: [edgerum-contract.md](edgerum-contract.md). Decisions: [adr/](adr/).

Web-only metrics (Web Vitals, page_load, resource_timing, long_task) are a **separate
RN-Web track**, not part of native v3.0.0 (ADR-0004).

---

## Workstream A — the wire spine (do first; everything depends on it)

| # | Change | File(s) | Target |
|---|---|---|---|
| A1 | Batch envelope | `adapters/nativeSender.ts`, `webSender.ts` | body = `{ type:"telemetry_batch", timestamp:<ISO>, location?, batch_size, events }`; POST to `/collector/telemetry`. No `tenant_id`, no `contract_version` |
| A2 | Auth header | both senders, `createTelemetry.ts`, `index.*.ts` | `X-API-Key: <apiKey>`; `apiKey` required in opts, must start `edge_`; reject otherwise (ADR-0003) |
| A3 | Event/metric shape + allowlist | `core/telemetry.ts` (`TelemetryEvent`) | event = `{type:"event",eventName,timestamp:<ISO>,attributes}`; metric adds `metricName`+`value`. **Drop top-level `userId`/`sessionId`**. Enforce the 12-name allowlist; unknown → `custom_event` with `event.name` |
| A4 | ID formats | `core/utils/uuid.{web,native}.ts`, `core/telemetry.ts` | `device_{ms}_{16hex}_{os}`, `session_{ms}_{16hex}_{os}` (suffix = device OS `ios`/`android`), `user_{ms}_{16hex}` (no suffix). 16 hex = 64 bits |

## Workstream B — the Context block (ADR-0002)

| # | Change | File(s) | Target |
|---|---|---|---|
| B1 | Merge context into every event | `core/telemetry.ts` `log()` | flatten App/Device/Network/Session/User/SDK into `attributes` |
| B2 | Delete standalone context events | `adapters/*/deviceInfo*`, `*/networkInfo*` | remove `device_info`/`network_info` events; keep collectors feeding B1 |
| B3 | New context fields | deviceInfo + networkInfo adapters | `app.{name,version,package_name,build_number,environment}`, `device.{batteryLevel,batteryCharging,screenWidth,screenHeight,pixelRatio,isVirtual,os}`, `network.{type,effectiveType}` (NOT `connected`/`downlinkMbps` — dropped) |
| B4 | SDK + session context | `core/telemetry.ts` | `sdk.{version,platform="react-native"}` (NO `contract_version`); `session.{start_time:<ISO>,sequence}` (NO `is_first_session`/`total_sessions`) |

## Workstream C — rename existing events to contract names

| # | From (v2) | To (contract) | File |
|---|---|---|---|
| C1 | `network_request` | `http.request` (`http.url/method/status_code/duration_ms/success/timestamp`) | `adapters/*/interceptFetch*` |
| C2 | `network_info_change` | `network_change` (+ `network.previous_type`) | `adapters/*/networkInfo*` |
| C3 | `screen_view`/`screen_end`/`performance.screen_duration` | `navigation` + `screen.duration` (`navigation.from_screen/to_screen/method/route_type`) | `adapters/navigationTracker.ts`, `screenTiming.ts`, `adapters/*/navigation*` |
| C4 | `frame_drop` | `frame_render_time` (metric) | `adapters/*/frameDrops*` |
| C5 | `memory_usage` | `memory_usage` (already aligned — verify attrs) | `adapters/*/memory*` |

## Workstream D — new capture (native parity)

| # | Event | What to build | File(s) |
|---|---|---|---|
| D1 | `app.crash` unification | funnel JS errors + console.error/warn into one `app.crash` keyed by `cause`; add `crash.breadcrumbs` ring buffer (last 20, JSON-stringified) | `adapters/*/crashHandler*`, new breadcrumb buffer in `core/` |
| D2 | Session lifecycle | `session.started` (init/resume/30-min rotation), `session.finalized` (background/close, immediate flush, journey summary + `sdk.error_count`) | `core/telemetry.ts` + AppState wiring in `index.native.ts` |
| D3 | `app_lifecycle` | foreground/background via RN `AppState` | new `adapters/native/appLifecycle.native.ts` |
| D4 | `user.interaction` | best-effort taps (no DOM target fields on native) | new native adapter, optional |
| D5 | `user.profile.update` / `custom_event` | emit `user.profile.update` on identify; route `log()` custom names through `custom_event` semantics | `core/telemetry.ts` |

## Workstream E — hygiene (rides along, low cost)

- E1 Debug-gate every `console.log` in `core/telemetry.ts` + senders (contract row: console noise).
- E2 One self-check per non-trivial unit: ID-format regex, envelope shape, context-merge, breadcrumb cap, `cause` routing. No framework — `assert`-based `demo()`/`__main__`-style or a tiny `*.test.ts`.

## Build order

A → B → C → D, E alongside. A+B unblock backend acceptance; C makes the events recognisable;
D reaches full native parity. Verify each workstream against a real captured payload diff
before moving on.

## Separate track (not v3.0.0)

RN-Web build web-only metrics: Web Vitals (LCP/FCP/CLS/INP/TTFB), `page_load`,
`resource_timing`, `long_task` via PerformanceObserver — `adapters/web/*` only.

## Open items to confirm with backend before shipping

All tracked in [backend-additions-ledger.md](backend-additions-ledger.md):
- `sdk.platform = "react-native"` accepted (new value, like iOS's `ios-native`).
- `device.id`/`session.id` `_android` and `_ios` suffixes both route (suffix = device OS).
- `navigation` keys: `from_screen/to_screen/method/route_type` (reference/Angular) vs iOS `screen/previous_screen/type/kind`.
- `resource_timing` namespace: `metric.*` vs iOS `resource.*` (web-only on RN anyway).
- Confirmed: backend derives `tenant_id` from the API key (ADR-0003, per iOS CLAUDE.md).
