# Live introspection of `edge_db` — 2026-09-03

Resolves [#85](https://github.com/NCG-Africa/edge_telemetry_react_native/issues/85). Read-only
introspection of the live `edge_db` the analytics service points at
(`edge_telemetry_rum_analytics/.env` → `102.164.37.218:5433/edge_db`), reached through the running
`edge-telemetry-rum-analytics` container. Reproduce with
[`introspect_edge_db.sql`](./introspect_edge_db.sql).

**Server:** PostgreSQL 18.1 (x86_64-windows), TimescaleDB installed.
**Database:** `edge_db`, 32 schemas — `public` (all `rum_*` / `processor_*` tables), plus `core`,
`alerts`, `analytics`, `traces`, `metrics`, `logs`, `synthetic`, `profiling`, `aiops`, `auth`,
`dashboards`, `rum` (a *separate*, unrelated 7-table schema: `apps`, `errors`, `events`,
`long_tasks`, `network_requests`, `pageviews`, `raw_events`) and others. **The RN wire contract
lands in `public` only.**

---

## 1. The headline: `already shipped` is now checkable, and the answer is "more than the repos say"

`schema_migrations` reports **version 5**. The processor repo ships **four** migrations
(`0001_init` … `0004_processor_dead_letter_events`). A fifth has been applied out of band and exists
in neither repository — this is the third schema source #81 §0 named, now confirmed by version
number rather than inferred from column drift.

**Diff against `schema_check.go:14-28` (the processor's declaration of what it needs):**

> **Zero processor-required columns are missing from the live schema.** `VerifySchema` would log
> nothing today. Every column across all 13 declared tables is present.

Drift runs entirely the *other* way — the live schema is a superset. Live columns on
processor-touched tables that `schema_check.go` does not declare:

| Table | Undeclared live columns |
|---|---|
| `rum_http_requests` | `id`, `created_at`, **`geo_location_id`**, **`trace_adopted`**, **`trace_injection`**, **`user_action_id`** |
| `rum_sessions` | `id`, `created_at`, `app_version_id`, `end_time`, `geo_location_id`, `last_activity_at`, `location`, `status` |
| `rum_users` | `id`, `created_at`, `app_id`, `email`, `name`, `phone`, `profile_data`, `profile_updated_at`, `profile_version` |
| `rum_telemetry_events` | `id`, `created_at`, `geo_location_id` |
| `rum_devices` | `id`, `created_at`, `user_id` |
| `rum_screen_durations` | `id`, `created_at`, `source` |
| others | `id`, `created_at` only |

The four bolded `rum_http_requests` columns are exactly #85's "out-of-band DDL" list — all four are
real, and **all four sit on `rum_http_requests`, not `rum_telemetry_events`** as the ticket
supposed.

**Also confirmed:** `rum_apps.tenant_id` is **`uuid NOT NULL`** live, against `BIGINT` in analytics
`000_create_rum_database.sql`. The analytics migration file is wrong about a column it declares.

---

## 2. `trace_injection` — the enum exists, and it is not #65's ladder

**Type:** `public.trace_injection_outcome` (not `trace_injection` — that is the *column* name).
**Column:** `rum_http_requests.trace_injection`, nullable. Also surfaced by three views —
`v_trace_correlation`, `v_trace_orphans`, `v_trace_attribution_health`.

**Six labels, in sort order:**

```
injected_attributed
injected_unattributed_no_action
injected_unattributed_context_lost
injected_inbound_malformed
adopted
skipped_off_allowlist
```

**Diff against [#65](https://github.com/NCG-Africa/edge_telemetry_react_native/issues/65)'s
seven-value ladder** (six core + web-only `skipped_no_cors`):

| #65 value | Live enum | Note |
|---|---|---|
| `skipped_off_allowlist` | ✅ present | |
| `skipped_no_cors` | ❌ absent | web-only, RN-web is greenfield |
| `skipped_consumer_set` | ❌ absent | but see `injected_inbound_malformed` below |
| `adopted` | ✅ present | |
| `injected_attributed` | ✅ present | |
| `injected_expired` | ❌ absent | #54 §5's falsification loop has no live value |
| `injected_unattributed` | ❌ absent | live splits it in two by *cause* |
| — | `injected_unattributed_no_action` | live-only |
| — | `injected_unattributed_context_lost` | live-only |
| — | `injected_inbound_malformed` | live-only |

Three of seven overlap. **#67's ask — "outcome as text, enum retired" — is therefore a widening,
a re-partition and a semantic conflict all at once, not a replacement:**

1. **Widening.** Four #65 values have no live label. Keeping the enum means four `ALTER TYPE … ADD
   VALUE` calls, which is why text is the right ask — but the document must say the ask is *four
   new values*, not "seven where six stand".
2. **Re-partition.** The live schema splits `injected_unattributed` by cause (`no_action` vs
   `context_lost`); #65 collapses it. Those two live labels are strictly more informative and
   #68 should adopt them rather than flatten them away — RN can distinguish both cases.
3. **Semantic conflict, and it is the important one.** Live `injected_inbound_malformed` says the
   processor's model is *inject over a malformed inbound header*. #65 §6 ruled the opposite:
   `skipped_consumer_set` is a **skip**, because "overwriting a consumer's bad header is illegal
   under §5's never-strip". Same situation, opposite verb. **#68 must state which wins**, or the
   backend sizes a column whose semantics contradict the SDK's documented behaviour.

**Population: 0 of 1,390,117 `rum_http_requests` rows carry a non-null `trace_injection`.** The
enum is shipped-and-unfilled — nothing to migrate, no back-compat cost to redefining it.

Neighbouring trace columns, same table:

| Column | Type | Populated |
|---|---|---|
| `trace_id` | `bpchar` | 112 / 1,390,117 |
| `span_id` | `bpchar` | 112 |
| `parent_span_id` | `bpchar` | 0 |
| `trace_adopted` | `boolean` | 1,390,117 (non-null on every row) |
| `user_action_id` | `bigint` → `rum_user_actions` | 0 |

The 112 traced rows are the Android 2.2.2 traffic. `rum_user_actions` and `rum_trace_spans` both
have **0 rows** — tables exist, nothing writes to them.

---

## 3. `rum_geo_locations` has rows, and the geo path is not the one #67 assumed

**18 rows. 348,516 `rum_http_requests` rows carry a `geo_location_id`.** The table is live and in
active use.

But `geo_source` on every row is **`'ip'`** — geo is derived from the request IP by an enrichment
path in neither repo, not from the SDK's `body["geo"]` block. Columns: `id`, `country_code`,
`region`, `city`, `lat`, `lng`, `accuracy_radius`, `geo_source`, `first_seen_at`, `last_seen_at`.
Coverage is African-market (KE, NG, GH, ET, ZA, RW …) with `accuracy_radius` 5–1000 km.

`geo_location_id` is on **five** tables plus two rollups: `rum_http_requests`, `rum_sessions`,
`rum_telemetry_events`, `rum_crash_events`, `rum_user_actions`, `rum_geo_rollup_hourly` (9,185
rows), `rum_geo_rollup_daily` (434 rows).

Coverage by device platform:

| `rum_devices.platform` | http rows | with geo |
|---|---|---|
| `Android` | 919,877 | 0 |
| `android` | 302,795 | 302,611 |
| `iOS` | 121,445 | 0 |
| `ios` | 45,933 | 45,905 |
| `web` | 67 | 0 |

**Two findings sit in that table.** First, `rum_devices.platform` carries **case-split duplicates**
(`Android` and `android`, `iOS` and `ios`) — a live data-quality defect that splits every
platform-grouped chart in two, and one #68 should name since RN sends `Platform.OS` lowercase.
Second, **all 67 RN-web rows have no geo** — the enrichment path that populates 348k Android/iOS
rows is not reaching the RN traffic.

**#67's ask changes shape:** "persist `body["geo"]`" is not a greenfield ask against an empty
table. It is a *second* source for a column an IP-based path already fills for two platforms.
#68 must say which source wins, or the backend has a precedence question it cannot answer.

---

## 4. #67's `rum_performance_metrics` targets are all live

| Column | Live type | Populated |
|---|---|---|
| `unit` | `varchar` | yes (171,348 on `app.startup_time` alone) |
| `memory_type` | `varchar` | yes (69 rows on `memory_usage`, 2,593 on `network.latency`) |
| `memory_source` | `varchar` | yes, same rows |
| `frame_build_duration_ms` | `float8` | yes |
| `frame_raster_duration_ms` | `float8` | yes |
| `frame_type` | `varchar` | yes |
| `frame_dropped` | `boolean` | yes |

All seven exist and carry data, despite analytics `000_create_rum_database.sql` declaring none of
the first three and `CREATE TABLE IF NOT EXISTS` being unable to have added them. **These are
genuinely `already shipped`** — the processor's `0001` DDL, or the out-of-band fifth migration,
put them there.

Other #67 targets, all present: `rum_devices.device_id` (`varchar`), `rum_devices.fingerprint`
(`text`), `rum_ui_interactions.ui_direction` and `ui_name_source` (both `varchar`),
`rum_telemetry_events.rum_action_id` / `trace_root_type` / `span_start_time` / `span_duration_ms`.

Note the type split on trace ids: `rum_http_requests` uses **`bpchar`** (fixed-width `character`),
`rum_telemetry_events` uses **`varchar`**. Same logical id, two physical types, across the join.

---

## 5. The bag is empty on 99.97% of rows — and why that is *not* what it looks like

`rum_telemetry_events`: **4,146,233 rows. 4,145,161 have `attributes = '{}'`. 1,072 have anything
at all.** No row has `attributes IS NULL`.

The empty-bag rows are **simulator output**, not lost production data. Their event names —
`business.transfer_completed`, `app.launch`, `app.startup_time`, `user.action`, `network.latency` —
are on neither SDK's allowlist and map one-for-one onto
`edge_telemetry_simulator/src/simulator/journeys.py`. They span 2026-04-16 → 2026-08-27.

The 1,072 bag-carrying rows are **real SDK traffic from 2026-08-30 onward**: 857 Android 2.2.2 and
**215 React Native 3.0.0**.

**Two consequences for the map:**

- **#69's "separable only by `sdk.version`" is worse than charted.** `sdk.version` is not just
  unpromoted — it is *absent from the bag* on every row but 1,072. A migration note that tells a
  consumer to split on `sdk.version` is telling them to split on a key their historical data does
  not have. This strengthens, not weakens, #67's ask to promote it.
- **There is no production RN data to validate a promotion call against.** 215 RN events, 67 of
  them `http.request`. Every promote-vs-bag call in #68 is a judgement about future volume, and
  the document should say so rather than implying it was measured.

### What RN 3.0.0 actually puts on the wire (ground truth, all 215 events)

Present on **all 215**: `app.name`, `app.packageName`, `app.version`, `device.brand`, `device.id`,
`device.manufacturer`, `device.model`, `device.platform`, `device.platformVersion`,
`network.isConnected`, `network.type`, `sdk.platform`, `sdk.version`, `session.id`,
`session.sequence`, `session.start_time`, `user.id`.

Per-event: `http.*` (67 — `url`, `host`, `path`, `method`, `status_code`, `duration_ms`, `success`,
`response_size`; `request_size` on only 6), `app_lifecycle.state` (67), `frame.*` (33 — `p95_ms`,
`max_ms`, `dropped_count`, `target_hz`, `source`), `user.*` profile keys (`name`/`email`/`fullName`
91, `createdAt`/`updatedAt` 109), `session.duration_ms` / `event_count` / `sdk.error_count` (10),
`memory.*` (9), `crash.*` (4).

This corroborates the audit key-for-key, and independently confirms three map claims:
`frame.target_hz` still ships pre-#78's rename; `user.fullName` / `createdAt` / `updatedAt` still
ship pre-#70's removal; and **`http.host` and `http.path` are present on all 67 rows**, so §8.9's
loss case is narrower than a blanket one — though 67 events is a thin sample, and none of them
need be first-party.

---

## 6. Row counts, live

Exact counts where queried directly (`rum_telemetry_events`, `rum_http_requests`, `rum_errors`,
`rum_navigations`, `rum_trace_spans`, `rum_user_actions`, `rum_geo_locations`, `processor_*`);
`pg_class.reltuples` estimates otherwise.

| Table | Rows |
|---|---|
| `rum_telemetry_events` | 4,146,233 |
| `rum_http_requests` | 1,390,117 |
| `rum_screen_durations` | 802,174 |
| `rum_navigation_events` | 583,907 |
| `rum_performance_metrics` | 506,012 |
| `rum_performance_events` | 470,783 |
| `rum_sessions` | 235,076 |
| `rum_session_summaries` | 228,620 |
| `rum_user_experience_daily` | 80,895 |
| `rum_geo_rollup_hourly` | 9,185 |
| `rum_crash_events` | 4,663 |
| `rum_devices` | 3,698 |
| `rum_users` | 3,668 |
| `rum_geo_rollup_daily` | 434 |
| `rum_ui_interactions` | 258 |
| `rum_apps` | 58 |
| `processor_frame_summaries` | 41 |
| `rum_app_versions` | 38 |
| `rum_api_keys` | 28 |
| `rum_navigations` | **25** |
| `rum_geo_locations` | 18 |
| `rum_errors` | **7** |
| `processor_device_context` | 5 |
| `rum_trace_spans` | **0** |
| `rum_user_actions` | **0** |
| `processor_session_geo` | **0** |
| `processor_dead_letter_events` | **0** |
| `rum_apdex_thresholds` | 0 |
| `rum_user_experience_windows` | 0 |

Note the split pairs: `rum_navigation_events` (583,907 — the analytics-owned table) against
`rum_navigations` (25 — the processor-owned one); `rum_crash_events` (4,663) against `rum_errors`
(7). **The processor's own tables are near-empty while the analytics-owned equivalents carry the
volume.** #72 settled which artifact serves the endpoint; this is what that looks like in row
counts, and #68 must name the target table per key unambiguously.

Views in `public`: `rum_action_envelopes`, `v_trace_correlation`, `v_trace_orphans`,
`v_trace_attribution_health`.

---

## 7. Full column dump

Every column in `public`, `rum_*` / `processor_*` tables and views, ordinal order.

### `processor_dead_letter_events`  — est. rows: -1

| # | column | type | udt | null | default |
|---|---|---|---|---|---|
| 1 | `id` | bigint | `int8` | NO | `nextval('processor_dead_letter_events_id` |
| 2 | `kafka_topic` | text | `text` | YES |  |
| 3 | `kafka_partition` | integer | `int4` | YES |  |
| 4 | `kafka_offset` | bigint | `int8` | YES |  |
| 5 | `tenant_id` | text | `text` | YES |  |
| 6 | `batch_timestamp` | timestamp with time zone | `timestamptz` | YES |  |
| 7 | `event_name` | text | `text` | YES |  |
| 8 | `event_json` | jsonb | `jsonb` | NO |  |
| 9 | `error` | text | `text` | NO |  |
| 10 | `failed_at` | timestamp with time zone | `timestamptz` | NO | `now()` |
| 11 | `replayed_at` | timestamp with time zone | `timestamptz` | YES |  |
| 12 | `replay_error` | text | `text` | YES |  |

### `processor_device_context`  — est. rows: 5

| # | column | type | udt | null | default |
|---|---|---|---|---|---|
| 1 | `rum_device_id` | bigint | `int8` | NO |  |
| 2 | `locale` | character varying(32) | `varchar` | YES |  |
| 3 | `timezone` | character varying(64) | `varchar` | YES |  |
| 4 | `low_ram` | boolean | `bool` | YES |  |
| 5 | `dark_mode` | boolean | `bool` | YES |  |
| 6 | `cpu_abi` | character varying(32) | `varchar` | YES |  |
| 7 | `cpu_cores` | integer | `int4` | YES |  |
| 8 | `screen_density` | integer | `int4` | YES |  |
| 9 | `screen_width_px` | integer | `int4` | YES |  |
| 10 | `screen_height_px` | integer | `int4` | YES |  |
| 11 | `refresh_rate` | integer | `int4` | YES |  |
| 12 | `updated_at` | timestamp with time zone | `timestamptz` | NO | `now()` |

### `processor_frame_summaries`  — est. rows: -1

| # | column | type | udt | null | default |
|---|---|---|---|---|---|
| 1 | `id` | bigint | `int8` | NO | `nextval('processor_frame_summaries_id_se` |
| 2 | `telemetry_event_id` | bigint | `int8` | NO |  |
| 3 | `max_build_duration_ms` | double precision | `float8` | YES |  |
| 4 | `max_raster_duration_ms` | double precision | `float8` | YES |  |
| 5 | `max_total_duration_ms` | double precision | `float8` | YES |  |
| 6 | `slow_frames` | integer | `int4` | YES |  |
| 7 | `frozen_frames` | integer | `int4` | YES |  |
| 8 | `total_frames` | integer | `int4` | YES |  |
| 9 | `slow_frame_rate` | double precision | `float8` | YES |  |
| 10 | `window_duration_ms` | double precision | `float8` | YES |  |
| 11 | `created_at` | timestamp with time zone | `timestamptz` | NO | `now()` |

### `processor_session_geo`  — est. rows: -1

| # | column | type | udt | null | default |
|---|---|---|---|---|---|
| 1 | `session_id` | bigint | `int8` | NO |  |
| 2 | `country_code` | character varying(8) | `varchar` | YES |  |
| 3 | `region` | character varying(128) | `varchar` | YES |  |
| 4 | `city` | character varying(128) | `varchar` | YES |  |
| 5 | `lat` | double precision | `float8` | YES |  |
| 6 | `lng` | double precision | `float8` | YES |  |
| 7 | `accuracy_radius` | integer | `int4` | YES |  |
| 8 | `geo_source` | character varying(32) | `varchar` | YES |  |
| 9 | `updated_at` | timestamp with time zone | `timestamptz` | NO | `now()` |

### `rum_action_envelopes`  — est. rows: view

| # | column | type | udt | null | default |
|---|---|---|---|---|---|
| 1 | `rum_action_id` | character varying(16) | `varchar` | YES |  |
| 2 | `trace_id` | text | `text` | YES |  |
| 3 | `root_type` | text | `text` | YES |  |
| 4 | `root_start` | timestamp with time zone | `timestamptz` | YES |  |
| 5 | `envelope` | interval | `interval` | YES |  |

### `rum_apdex_thresholds`  — est. rows: 0

| # | column | type | udt | null | default |
|---|---|---|---|---|---|
| 1 | `metric_type` | character varying(100) | `varchar` | NO |  |
| 2 | `satisfied_ms` | integer | `int4` | NO |  |
| 3 | `tolerated_ms` | integer | `int4` | NO |  |
| 4 | `updated_at` | timestamp with time zone | `timestamptz` | NO |  |

### `rum_api_keys`  — est. rows: 28

| # | column | type | udt | null | default |
|---|---|---|---|---|---|
| 1 | `id` | integer | `int4` | NO | `nextval('rum_api_keys_id_seq'::regclass)` |
| 2 | `tenant_id` | uuid | `uuid` | NO |  |
| 3 | `user_id` | character varying(100) | `varchar` | NO |  |
| 4 | `api_key_id` | character varying(100) | `varchar` | NO |  |
| 5 | `api_key_hash` | character varying(64) | `varchar` | NO |  |
| 6 | `api_created_at` | timestamp with time zone | `timestamptz` | NO | `now()` |
| 7 | `api_expires_at` | timestamp with time zone | `timestamptz` | YES |  |
| 8 | `api_revoked_at` | timestamp with time zone | `timestamptz` | YES |  |
| 9 | `description` | text | `text` | YES |  |
| 10 | `api_key_name` | character varying(100) | `varchar` | YES |  |

### `rum_app_versions`  — est. rows: 38

| # | column | type | udt | null | default |
|---|---|---|---|---|---|
| 1 | `id` | integer | `int4` | NO | `nextval('rum_app_versions_id_seq'::regcl` |
| 2 | `app_id` | integer | `int4` | NO |  |
| 3 | `version` | character varying(50) | `varchar` | YES |  |
| 4 | `build_number` | character varying(50) | `varchar` | YES |  |
| 5 | `first_seen_at` | timestamp with time zone | `timestamptz` | NO | `now()` |
| 6 | `last_seen_at` | timestamp with time zone | `timestamptz` | NO | `now()` |

### `rum_apps`  — est. rows: 58

| # | column | type | udt | null | default |
|---|---|---|---|---|---|
| 1 | `id` | bigint | `int8` | NO | `nextval('rum_apps_id_seq'::regclass)` |
| 2 | `tenant_id` | uuid | `uuid` | NO |  |
| 3 | `name` | character varying(255) | `varchar` | NO |  |
| 4 | `version` | character varying(50) | `varchar` | NO |  |
| 5 | `build_number` | character varying(50) | `varchar` | NO |  |
| 6 | `package_name` | character varying(255) | `varchar` | NO |  |
| 7 | `created_at` | timestamp with time zone | `timestamptz` | NO | `now()` |

### `rum_crash_events`  — est. rows: 4663

| # | column | type | udt | null | default |
|---|---|---|---|---|---|
| 1 | `id` | bigint | `int8` | NO | `nextval('rum_crash_events_id_seq'::regcl` |
| 2 | `error_message` | text | `text` | NO |  |
| 3 | `stack_trace` | text | `text` | YES |  |
| 4 | `exception_type` | character varying(255) | `varchar` | YES |  |
| 5 | `error_context` | character varying(500) | `varchar` | YES |  |
| 6 | `product_id` | character varying(255) | `varchar` | YES |  |
| 7 | `cause` | character varying(255) | `varchar` | YES |  |
| 8 | `severity_level` | character varying(50) | `varchar` | YES |  |
| 9 | `error_code` | character varying(100) | `varchar` | YES |  |
| 10 | `user_action` | text | `text` | YES |  |
| 11 | `breadcrumbs` | text | `text` | YES |  |
| 12 | `breadcrumb_count` | integer | `int4` | YES |  |
| 13 | `is_fatal` | boolean | `bool` | YES |  |
| 14 | `crash_hash` | character varying(64) | `varchar` | YES |  |
| 15 | `created_at` | timestamp with time zone | `timestamptz` | NO | `now()` |
| 16 | `telemetry_event_id` | bigint | `int8` | NO |  |
| 17 | `user_id` | bigint | `int8` | YES |  |
| 18 | `session_id` | bigint | `int8` | YES |  |
| 19 | `app_id` | bigint | `int8` | YES |  |
| 20 | `device_id` | bigint | `int8` | YES |  |
| 21 | `geo_location_id` | integer | `int4` | YES |  |

### `rum_devices`  — est. rows: 3698

| # | column | type | udt | null | default |
|---|---|---|---|---|---|
| 1 | `id` | bigint | `int8` | NO | `nextval('rum_devices_id_seq'::regclass)` |
| 2 | `device_id` | character varying(255) | `varchar` | YES |  |
| 3 | `platform` | character varying(50) | `varchar` | NO |  |
| 4 | `platform_version` | character varying(255) | `varchar` | YES |  |
| 5 | `model` | character varying(255) | `varchar` | YES |  |
| 6 | `manufacturer` | character varying(255) | `varchar` | YES |  |
| 7 | `brand` | character varying(255) | `varchar` | YES |  |
| 8 | `android_sdk` | character varying(10) | `varchar` | YES |  |
| 9 | `android_release` | character varying(50) | `varchar` | YES |  |
| 10 | `fingerprint` | text | `text` | YES |  |
| 11 | `hardware` | character varying(255) | `varchar` | YES |  |
| 12 | `product` | character varying(255) | `varchar` | YES |  |
| 13 | `created_at` | timestamp with time zone | `timestamptz` | NO | `now()` |
| 14 | `user_id` | integer | `int4` | YES |  |

### `rum_errors`  — est. rows: -1

| # | column | type | udt | null | default |
|---|---|---|---|---|---|
| 1 | `id` | integer | `int4` | NO | `nextval('rum_errors_id_seq'::regclass)` |
| 2 | `message` | character varying(1000) | `varchar` | YES |  |
| 3 | `stacktrace` | character varying(2000) | `varchar` | YES |  |
| 4 | `exception_type` | character varying(255) | `varchar` | YES |  |
| 5 | `cause` | text | `text` | YES |  |
| 6 | `error_context` | text | `text` | YES |  |
| 7 | `user_action` | text | `text` | YES |  |
| 8 | `error_code` | character varying(255) | `varchar` | YES |  |
| 9 | `crash_thread` | character varying(255) | `varchar` | YES |  |
| 10 | `crash_is_main_thread` | boolean | `bool` | YES |  |
| 11 | `is_fatal` | boolean | `bool` | YES |  |
| 12 | `handled` | boolean | `bool` | YES |  |
| 13 | `anr_duration_ms` | double precision | `float8` | YES |  |
| 14 | `hang_duration_ms` | double precision | `float8` | YES |  |
| 15 | `screen_name` | character varying(255) | `varchar` | YES |  |
| 16 | `created_at` | timestamp with time zone | `timestamptz` | YES | `now()` |
| 17 | `telemetry_event_id` | integer | `int4` | NO |  |

### `rum_geo_locations`  — est. rows: 18

| # | column | type | udt | null | default |
|---|---|---|---|---|---|
| 1 | `id` | integer | `int4` | NO | `nextval('rum_geo_locations_id_seq'::regc` |
| 2 | `country_code` | character varying(2) | `varchar` | NO |  |
| 3 | `region` | character varying(100) | `varchar` | YES |  |
| 4 | `city` | character varying(100) | `varchar` | YES |  |
| 5 | `lat` | numeric | `numeric` | YES |  |
| 6 | `lng` | numeric | `numeric` | YES |  |
| 7 | `accuracy_radius` | integer | `int4` | YES |  |
| 8 | `geo_source` | character varying(20) | `varchar` | YES |  |
| 9 | `first_seen_at` | timestamp without time zone | `timestamp` | YES | `CURRENT_TIMESTAMP` |
| 10 | `last_seen_at` | timestamp without time zone | `timestamp` | YES | `CURRENT_TIMESTAMP` |

### `rum_geo_rollup_daily`  — est. rows: 434

| # | column | type | udt | null | default |
|---|---|---|---|---|---|
| 1 | `app_id` | integer | `int4` | NO |  |
| 2 | `geo_location_id` | bigint | `int8` | NO |  |
| 3 | `bucket_start` | timestamp with time zone | `timestamptz` | NO |  |
| 4 | `session_count` | integer | `int4` | NO | `0` |
| 5 | `distinct_user_count` | integer | `int4` | NO | `0` |
| 6 | `crash_count` | integer | `int4` | NO | `0` |
| 7 | `http_error_count` | integer | `int4` | NO | `0` |
| 8 | `apdex_satisfied` | integer | `int4` | NO | `0` |
| 9 | `apdex_tolerating` | integer | `int4` | NO | `0` |
| 10 | `apdex_total` | integer | `int4` | NO | `0` |
| 11 | `conversion_count` | integer | `int4` | NO | `0` |
| 12 | `converting_users` | integer | `int4` | NO | `0` |
| 13 | `refreshed_at` | timestamp with time zone | `timestamptz` | NO | `now()` |
| 14 | `http_total` | integer | `int4` | NO | `0` |
| 15 | `p95_duration_ms` | double precision | `float8` | YES |  |

### `rum_geo_rollup_hourly`  — est. rows: 9185

| # | column | type | udt | null | default |
|---|---|---|---|---|---|
| 1 | `app_id` | integer | `int4` | NO |  |
| 2 | `geo_location_id` | bigint | `int8` | NO |  |
| 3 | `bucket_start` | timestamp with time zone | `timestamptz` | NO |  |
| 4 | `session_count` | integer | `int4` | NO | `0` |
| 5 | `distinct_user_count` | integer | `int4` | NO | `0` |
| 6 | `crash_count` | integer | `int4` | NO | `0` |
| 7 | `http_error_count` | integer | `int4` | NO | `0` |
| 8 | `apdex_satisfied` | integer | `int4` | NO | `0` |
| 9 | `apdex_tolerating` | integer | `int4` | NO | `0` |
| 10 | `apdex_total` | integer | `int4` | NO | `0` |
| 11 | `conversion_count` | integer | `int4` | NO | `0` |
| 12 | `converting_users` | integer | `int4` | NO | `0` |
| 13 | `refreshed_at` | timestamp with time zone | `timestamptz` | NO | `now()` |
| 14 | `http_total` | integer | `int4` | NO | `0` |
| 15 | `p95_duration_ms` | double precision | `float8` | YES |  |

### `rum_http_requests`  — est. rows: 1389938

| # | column | type | udt | null | default |
|---|---|---|---|---|---|
| 1 | `id` | bigint | `int8` | NO | `nextval('rum_http_requests_id_seq'::regc` |
| 2 | `url` | text | `text` | NO |  |
| 3 | `method` | character varying(10) | `varchar` | NO |  |
| 4 | `status_code` | integer | `int4` | NO |  |
| 5 | `duration_ms` | integer | `int4` | NO |  |
| 6 | `request_timestamp` | timestamp with time zone | `timestamptz` | NO |  |
| 7 | `success` | boolean | `bool` | NO |  |
| 8 | `created_at` | timestamp with time zone | `timestamptz` | NO | `now()` |
| 9 | `telemetry_event_id` | bigint | `int8` | NO |  |
| 10 | `user_id` | bigint | `int8` | YES |  |
| 11 | `session_id` | bigint | `int8` | YES |  |
| 12 | `app_id` | bigint | `int8` | YES |  |
| 13 | `device_id` | bigint | `int8` | YES |  |
| 14 | `geo_location_id` | integer | `int4` | YES |  |
| 15 | `trace_id` | character(32) | `bpchar` | YES |  |
| 16 | `span_id` | character(16) | `bpchar` | YES |  |
| 17 | `parent_span_id` | character(16) | `bpchar` | YES |  |
| 18 | `trace_injection` | USER-DEFINED | `trace_injection_outcome` | YES |  |
| 19 | `trace_adopted` | boolean | `bool` | NO | `false` |
| 20 | `user_action_id` | bigint | `int8` | YES |  |

### `rum_navigation_events`  — est. rows: 583907

| # | column | type | udt | null | default |
|---|---|---|---|---|---|
| 1 | `id` | bigint | `int8` | NO | `nextval('rum_navigation_events_id_seq'::` |
| 2 | `from_screen` | character varying(255) | `varchar` | YES |  |
| 3 | `to_screen` | character varying(255) | `varchar` | NO |  |
| 4 | `navigation_method` | character varying(50) | `varchar` | NO |  |
| 5 | `route_type` | character varying(100) | `varchar` | YES |  |
| 6 | `has_arguments` | boolean | `bool` | NO | `false` |
| 7 | `timestamp` | timestamp with time zone | `timestamptz` | NO |  |
| 8 | `created_at` | timestamp with time zone | `timestamptz` | NO | `now()` |
| 9 | `session_id` | bigint | `int8` | NO |  |
| 10 | `user_id` | bigint | `int8` | NO |  |
| 11 | `app_id` | bigint | `int8` | YES |  |
| 12 | `device_id` | bigint | `int8` | YES |  |

### `rum_navigations`  — est. rows: -1

| # | column | type | udt | null | default |
|---|---|---|---|---|---|
| 1 | `id` | integer | `int4` | NO | `nextval('rum_navigations_id_seq'::regcla` |
| 2 | `from_screen` | character varying(255) | `varchar` | NO | `''::character varying` |
| 3 | `to_screen` | character varying(255) | `varchar` | YES |  |
| 4 | `method` | character varying(50) | `varchar` | YES |  |
| 5 | `route_type` | character varying(50) | `varchar` | YES |  |
| 6 | `has_arguments` | boolean | `bool` | YES |  |
| 7 | `navigation_timestamp` | timestamp with time zone | `timestamptz` | YES |  |
| 8 | `created_at` | timestamp with time zone | `timestamptz` | YES | `now()` |
| 9 | `telemetry_event_id` | integer | `int4` | NO |  |

### `rum_performance_events`  — est. rows: 470783

| # | column | type | udt | null | default |
|---|---|---|---|---|---|
| 1 | `id` | bigint | `int8` | NO | `nextval('rum_performance_events_id_seq':` |
| 2 | `event_name` | character varying(255) | `varchar` | NO |  |
| 3 | `memory_usage_mb` | double precision | `float8` | YES |  |
| 4 | `memory_pressure_level` | character varying(50) | `varchar` | YES |  |
| 5 | `memory_timestamp` | timestamp with time zone | `timestamptz` | YES |  |
| 6 | `frame_build_duration_ms` | double precision | `float8` | YES |  |
| 7 | `frame_raster_duration_ms` | double precision | `float8` | YES |  |
| 8 | `frame_total_duration_ms` | double precision | `float8` | YES |  |
| 9 | `frame_severity` | character varying(50) | `varchar` | YES |  |
| 10 | `frame_target_fps` | integer | `int4` | YES |  |
| 11 | `created_at` | timestamp with time zone | `timestamptz` | NO | `now()` |
| 12 | `telemetry_event_id` | bigint | `int8` | NO |  |

### `rum_performance_metrics`  — est. rows: 506012

| # | column | type | udt | null | default |
|---|---|---|---|---|---|
| 1 | `id` | bigint | `int8` | NO | `nextval('rum_performance_metrics_id_seq'` |
| 2 | `metric_name` | character varying(255) | `varchar` | NO |  |
| 3 | `value` | double precision | `float8` | NO |  |
| 4 | `unit` | character varying(50) | `varchar` | YES |  |
| 5 | `frame_build_duration_ms` | double precision | `float8` | YES |  |
| 6 | `frame_raster_duration_ms` | double precision | `float8` | YES |  |
| 7 | `frame_type` | character varying(50) | `varchar` | YES |  |
| 8 | `frame_dropped` | boolean | `bool` | YES |  |
| 9 | `memory_type` | character varying(50) | `varchar` | YES |  |
| 10 | `memory_source` | character varying(50) | `varchar` | YES |  |
| 11 | `created_at` | timestamp with time zone | `timestamptz` | NO | `now()` |
| 12 | `telemetry_event_id` | bigint | `int8` | NO |  |

### `rum_screen_durations`  — est. rows: 802174

| # | column | type | udt | null | default |
|---|---|---|---|---|---|
| 1 | `id` | bigint | `int8` | NO | `nextval('rum_screen_durations_id_seq'::r` |
| 2 | `screen_name` | character varying(255) | `varchar` | NO |  |
| 3 | `duration_ms` | integer | `int4` | NO |  |
| 4 | `exit_method` | character varying(50) | `varchar` | YES |  |
| 5 | `timestamp` | timestamp with time zone | `timestamptz` | NO |  |
| 6 | `created_at` | timestamp with time zone | `timestamptz` | NO | `now()` |
| 7 | `session_id` | bigint | `int8` | NO |  |
| 8 | `user_id` | bigint | `int8` | NO |  |
| 9 | `app_id` | bigint | `int8` | YES |  |
| 10 | `device_id` | bigint | `int8` | YES |  |
| 11 | `source` | text | `text` | NO | `'sdk'::text` |

### `rum_session_summaries`  — est. rows: 228620

| # | column | type | udt | null | default |
|---|---|---|---|---|---|
| 1 | `session_id` | bigint | `int8` | NO |  |
| 2 | `network_requests_total` | integer | `int4` | NO | `0` |
| 3 | `success_rate` | double precision | `float8` | YES |  |
| 4 | `avg_latency_ms` | double precision | `float8` | YES |  |
| 5 | `p95_latency_ms` | double precision | `float8` | YES |  |
| 6 | `p99_latency_ms` | double precision | `float8` | YES |  |
| 7 | `crashes_total` | integer | `int4` | NO | `0` |
| 8 | `fatal_crashes` | integer | `int4` | NO | `0` |
| 9 | `unique_crash_hashes` | integer | `int4` | NO | `0` |
| 10 | `navigation_total` | integer | `int4` | NO | `0` |
| 11 | `unique_screens` | integer | `int4` | NO | `0` |
| 12 | `telemetry_total` | integer | `int4` | NO | `0` |
| 13 | `calculated_at` | timestamp with time zone | `timestamptz` | NO |  |
| 14 | `id` | integer | `int4` | NO | `nextval('rum_session_summaries_id_seq'::` |

### `rum_sessions`  — est. rows: 235076

| # | column | type | udt | null | default |
|---|---|---|---|---|---|
| 1 | `id` | bigint | `int8` | NO | `nextval('rum_sessions_id_seq'::regclass)` |
| 2 | `session_id` | character varying(255) | `varchar` | NO |  |
| 3 | `start_time` | timestamp with time zone | `timestamptz` | NO |  |
| 4 | `duration_ms` | integer | `int4` | YES |  |
| 5 | `event_count` | integer | `int4` | NO | `0` |
| 6 | `metric_count` | integer | `int4` | NO | `0` |
| 7 | `screen_count` | integer | `int4` | NO | `0` |
| 8 | `visited_screens` | text | `text` | YES |  |
| 9 | `is_first_session` | boolean | `bool` | NO | `false` |
| 10 | `total_sessions` | integer | `int4` | NO | `0` |
| 11 | `network_type` | character varying(50) | `varchar` | YES |  |
| 12 | `created_at` | timestamp with time zone | `timestamptz` | NO | `now()` |
| 13 | `app_id` | bigint | `int8` | NO |  |
| 14 | `device_id` | bigint | `int8` | NO |  |
| 15 | `user_id` | bigint | `int8` | NO |  |
| 16 | `location` | character varying(255) | `varchar` | YES |  |
| 17 | `status` | character varying(20) | `varchar` | YES | `'active'::character varying` |
| 18 | `end_time` | timestamp with time zone | `timestamptz` | YES |  |
| 19 | `last_activity_at` | timestamp with time zone | `timestamptz` | YES |  |
| 20 | `app_version_id` | integer | `int4` | YES |  |
| 21 | `geo_location_id` | integer | `int4` | YES |  |

### `rum_telemetry_events`  — est. rows: 4145161

| # | column | type | udt | null | default |
|---|---|---|---|---|---|
| 1 | `id` | bigint | `int8` | NO | `nextval('rum_telemetry_events_id_seq'::r` |
| 2 | `event_type` | character varying(50) | `varchar` | NO |  |
| 3 | `event_name` | character varying(255) | `varchar` | YES |  |
| 4 | `timestamp` | timestamp with time zone | `timestamptz` | NO |  |
| 5 | `batch_timestamp` | timestamp with time zone | `timestamptz` | NO |  |
| 6 | `created_at` | timestamp with time zone | `timestamptz` | NO | `now()` |
| 7 | `session_id` | bigint | `int8` | NO |  |
| 8 | `geo_location_id` | integer | `int4` | YES |  |
| 9 | `attributes` | jsonb | `jsonb` | NO | `'{}'::jsonb` |
| 10 | `trace_id` | character varying(32) | `varchar` | YES |  |
| 11 | `span_id` | character varying(16) | `varchar` | YES |  |
| 12 | `parent_span_id` | character varying(16) | `varchar` | YES |  |
| 13 | `rum_action_id` | character varying(16) | `varchar` | YES |  |
| 14 | `trace_root_type` | character varying(16) | `varchar` | YES |  |
| 15 | `span_start_time` | timestamp with time zone | `timestamptz` | YES |  |
| 16 | `span_duration_ms` | double precision | `float8` | YES |  |

### `rum_trace_spans`  — est. rows: -1

| # | column | type | udt | null | default |
|---|---|---|---|---|---|
| 1 | `span_id` | character(16) | `bpchar` | NO |  |
| 2 | `trace_id` | character(32) | `bpchar` | NO |  |
| 3 | `parent_span_id` | character(16) | `bpchar` | YES |  |
| 4 | `service_name` | character varying(255) | `varchar` | NO |  |
| 5 | `operation_name` | character varying(255) | `varchar` | NO |  |
| 6 | `span_kind` | character varying(20) | `varchar` | NO |  |
| 7 | `start_time` | timestamp with time zone | `timestamptz` | NO |  |
| 8 | `end_time` | timestamp with time zone | `timestamptz` | NO |  |
| 9 | `duration_ms` | integer | `int4` | YES |  |
| 10 | `status_code` | character varying(10) | `varchar` | NO | `'unset'::character varying` |
| 11 | `error_type` | character varying(255) | `varchar` | YES |  |
| 12 | `error_message` | text | `text` | YES |  |
| 13 | `http_method` | character varying(10) | `varchar` | YES |  |
| 14 | `http_route` | text | `text` | YES |  |
| 15 | `http_status_code` | integer | `int4` | YES |  |
| 16 | `db_system` | character varying(50) | `varchar` | YES |  |
| 17 | `db_operation` | character varying(255) | `varchar` | YES |  |
| 18 | `host_name` | character varying(255) | `varchar` | YES |  |
| 19 | `instance_id` | character varying(255) | `varchar` | YES |  |
| 20 | `attributes` | jsonb | `jsonb` | NO | `'{}'::jsonb` |
| 21 | `received_at` | timestamp with time zone | `timestamptz` | NO | `now()` |

### `rum_ui_interactions`  — est. rows: 258

| # | column | type | udt | null | default |
|---|---|---|---|---|---|
| 1 | `id` | integer | `int4` | NO | `nextval('rum_ui_interactions_id_seq'::re` |
| 2 | `ui_type` | character varying(50) | `varchar` | YES |  |
| 3 | `ui_target` | character varying(255) | `varchar` | YES |  |
| 4 | `ui_x` | integer | `int4` | YES |  |
| 5 | `ui_y` | integer | `int4` | YES |  |
| 6 | `ui_direction` | character varying(50) | `varchar` | YES |  |
| 7 | `ui_screen` | character varying(255) | `varchar` | YES |  |
| 8 | `ui_name_source` | character varying(50) | `varchar` | YES |  |
| 9 | `created_at` | timestamp with time zone | `timestamptz` | YES | `now()` |
| 10 | `telemetry_event_id` | integer | `int4` | NO |  |

### `rum_user_actions`  — est. rows: -1

| # | column | type | udt | null | default |
|---|---|---|---|---|---|
| 1 | `id` | bigint | `int8` | NO | `nextval('rum_user_actions_id_seq'::regcl` |
| 2 | `action_name` | character varying(255) | `varchar` | NO |  |
| 3 | `action_type` | character varying(50) | `varchar` | NO |  |
| 4 | `screen_name` | character varying(255) | `varchar` | YES |  |
| 5 | `start_time` | timestamp with time zone | `timestamptz` | NO |  |
| 6 | `end_time` | timestamp with time zone | `timestamptz` | YES |  |
| 7 | `duration_ms` | integer | `int4` | YES |  |
| 8 | `trace_id` | character(32) | `bpchar` | YES |  |
| 9 | `root_span_id` | character(16) | `bpchar` | YES |  |
| 10 | `created_at` | timestamp with time zone | `timestamptz` | NO | `now()` |
| 11 | `telemetry_event_id` | bigint | `int8` | NO |  |
| 12 | `session_id` | bigint | `int8` | YES |  |
| 13 | `user_id` | bigint | `int8` | YES |  |
| 14 | `app_id` | bigint | `int8` | YES |  |
| 15 | `device_id` | bigint | `int8` | YES |  |
| 16 | `geo_location_id` | integer | `int4` | YES |  |

### `rum_user_experience_daily`  — est. rows: 80895

| # | column | type | udt | null | default |
|---|---|---|---|---|---|
| 1 | `user_id` | bigint | `int8` | NO |  |
| 2 | `date` | date | `date` | NO |  |
| 3 | `last_updated` | timestamp with time zone | `timestamptz` | NO |  |
| 4 | `http_request_count` | integer | `int4` | NO | `0` |
| 5 | `http_satisfied_count` | integer | `int4` | NO | `0` |
| 6 | `http_tolerated_count` | integer | `int4` | NO | `0` |
| 7 | `http_frustrated_count` | integer | `int4` | NO | `0` |
| 8 | `failed_requests` | integer | `int4` | NO | `0` |
| 9 | `total_crashes` | integer | `int4` | NO | `0` |
| 10 | `fatal_crashes` | integer | `int4` | NO | `0` |
| 11 | `session_count` | integer | `int4` | NO | `0` |
| 12 | `short_sessions` | integer | `int4` | NO | `0` |
| 13 | `screen_view_count` | integer | `int4` | NO | `0` |
| 14 | `slow_screens` | integer | `int4` | NO | `0` |
| 15 | `navigation_count` | integer | `int4` | NO | `0` |

### `rum_user_experience_windows`  — est. rows: 0

| # | column | type | udt | null | default |
|---|---|---|---|---|---|
| 1 | `user_id` | bigint | `int8` | NO |  |
| 2 | `window_type` | character varying(10) | `varchar` | NO |  |
| 3 | `last_updated` | timestamp with time zone | `timestamptz` | NO |  |
| 4 | `apdex_score` | double precision | `float8` | YES |  |
| 5 | `crash_impact` | double precision | `float8` | YES |  |
| 6 | `frustration_score` | double precision | `float8` | YES |  |
| 7 | `session_count` | integer | `int4` | NO | `0` |
| 8 | `http_request_count` | integer | `int4` | NO | `0` |
| 9 | `screen_view_count` | integer | `int4` | NO | `0` |
| 10 | `navigation_count` | integer | `int4` | NO | `0` |

### `rum_users`  — est. rows: 3668

| # | column | type | udt | null | default |
|---|---|---|---|---|---|
| 1 | `id` | bigint | `int8` | NO | `nextval('rum_users_id_seq'::regclass)` |
| 2 | `user_id` | character varying(255) | `varchar` | NO |  |
| 3 | `created_at` | timestamp with time zone | `timestamptz` | NO | `now()` |
| 4 | `name` | character varying(255) | `varchar` | YES |  |
| 5 | `email` | character varying(255) | `varchar` | YES |  |
| 6 | `phone` | character varying(50) | `varchar` | YES |  |
| 7 | `profile_data` | text | `text` | YES |  |
| 8 | `profile_updated_at` | timestamp with time zone | `timestamptz` | YES |  |
| 9 | `profile_version` | integer | `int4` | NO | `1` |
| 10 | `app_id` | bigint | `int8` | YES |  |

### `v_trace_attribution_health`  — est. rows: view

| # | column | type | udt | null | default |
|---|---|---|---|---|---|
| 1 | `trace_injection` | USER-DEFINED | `trace_injection_outcome` | YES |  |
| 2 | `events` | bigint | `int8` | YES |  |
| 3 | `pct` | numeric | `numeric` | YES |  |

### `v_trace_correlation`  — est. rows: view

| # | column | type | udt | null | default |
|---|---|---|---|---|---|
| 1 | `trace_id` | character(32) | `bpchar` | YES |  |
| 2 | `span_id` | character(16) | `bpchar` | YES |  |
| 3 | `parent_span_id` | character(16) | `bpchar` | YES |  |
| 4 | `service_name` | character varying(255) | `varchar` | YES |  |
| 5 | `operation_name` | character varying(255) | `varchar` | YES |  |
| 6 | `span_start` | timestamp with time zone | `timestamptz` | YES |  |
| 7 | `span_duration_ms` | integer | `int4` | YES |  |
| 8 | `status_code` | character varying(10) | `varchar` | YES |  |
| 9 | `http_request_id` | bigint | `int8` | YES |  |
| 10 | `client_span_id` | character(16) | `bpchar` | YES |  |
| 11 | `http_method` | character varying(10) | `varchar` | YES |  |
| 12 | `client_duration_ms` | integer | `int4` | YES |  |
| 13 | `trace_injection` | USER-DEFINED | `trace_injection_outcome` | YES |  |
| 14 | `trace_adopted` | boolean | `bool` | YES |  |
| 15 | `user_action_id` | bigint | `int8` | YES |  |
| 16 | `action_name` | character varying(255) | `varchar` | YES |  |
| 17 | `screen_name` | character varying(255) | `varchar` | YES |  |
| 18 | `sdk_session_id` | character varying(255) | `varchar` | YES |  |

### `v_trace_orphans`  — est. rows: view

| # | column | type | udt | null | default |
|---|---|---|---|---|---|
| 1 | `http_request_id` | bigint | `int8` | YES |  |
| 2 | `trace_id` | character(32) | `bpchar` | YES |  |
| 3 | `span_id` | character(16) | `bpchar` | YES |  |
| 4 | `trace_injection` | USER-DEFINED | `trace_injection_outcome` | YES |  |
| 5 | `request_timestamp` | timestamp with time zone | `timestamptz` | YES |  |
