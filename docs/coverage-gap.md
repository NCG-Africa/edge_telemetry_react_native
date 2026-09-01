# Coverage gap — how many RN keys the processor actually reads

**Answer: 30 of 73 reach a column, and 26 reach a column the product reads. The other 43 land
in the `attributes` JSONB bag, which is durable, containment-indexed, and queried by nothing.**

This document was first written against processor `b9bf1b5` and reported **17 of 73, with 56
keys dropped outright**. That pin was 19 commits stale. At `origin/main` the failure mode has
changed shape: **no RN key is discarded any more** — `service.go:230-235` marshals the whole
attribute map into `rum_telemetry_events.attributes` on every event — so the question is no
longer *what survives ingest* but *what is reachable by a query*. Three tiers now exist where
there used to be two:

1. **Promoted and read** — a column exists and the analytics API selects it. **26 keys.**
2. **Promoted and unread** — a column exists, the processor fills it, no dashboard query
   touches the table. **4 keys** (all of `navigation.*`).
3. **Bag-only** — stored in `attributes`, no column, no reader. **43 keys.**

The old failure mode was silence at ingest. The new one is silence at query time: the payload
is on disk and nothing can see it.

**Sources, pinned.** SDK: `NCG-Africa/edge_telemetry_react_native` @ `b463a92` (v3.0.1; `src/`
unchanged since `99e1d7f`), key set per [`docs/wire-inventory.md`](./wire-inventory.md).
Processor: `NCG-Africa/EDGETELEMETRYPROCESSORGO` @ **`516a02f`** (`origin/main`, 2026-08-30),
local clone at `/Users/mktowett/Development/Windsurf/EDGETELEMETRYPROCESSORGO` — **this
supersedes #50's `b9bf1b5` pin for every claim about where a key lands.** Analytics service:
`NCG-Africa/edge_telemetry_rum_analytics` @ `264732f`, local clone at
`/Users/mktowett/Development/PycharmProjects/edge_telemetry_rum_analytics`. Every `file:line`
below is against those three. Regenerate the counts with
[Appendix A](#appendix-a--regenerate-the-counts).

---

## 0. Which schema the processor targets

#72 left this open: at `b9bf1b5` the processor's SQL matched neither its own migrations nor
`NCG-Africa/edge_db`'s `edge_apm_sql_enterprise_v012.sql`. `origin/main` answers it, and the
answer is *neither repository*.

The live `edge_db` schema is **owned by the EdgeTelemetryRUMAnalytics service**
(`migrations/000_create_rum_database.sql` + 17 follow-ups). The processor's own `0001`/`0002`
are written `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`, so against a database
the analytics service already created they are **partly no-ops** — the `CREATE TABLE`s do
nothing, while the `ADD COLUMN`s and `CREATE INDEX`es *do* apply. That asymmetry is how the
attributes bag and the seven trace columns reached an analytics-owned table.

The live schema is therefore a **merge of three sources**: analytics migrations, the
processor's additive DDL, and out-of-band DDL present in neither repo (`rum_http_requests`
carries `geo_location_id`, `trace_injection` (enum), `trace_adopted`, `user_action_id`;
`rum_apps.tenant_id` is `uuid` live but `BIGINT` in analytics `000`). Reading either repo's
SQL and calling it the schema is what produced the two broken inserts the conformance work
fixed.

Two consequences for the contract document:

- **The processor's machine-readable declaration of what it needs is
  `internal/db/schema_check.go:14-28`**, not the migrations. `VerifySchema` (`:34`) logs every missing
  column at startup and is advisory, not fatal, and runs at `main.go:46` — its existence is itself evidence
  that schema drift was a live production problem.
- **Ask for keys against `schema_check.go` + a live introspection**, never against a migration
  file.

`main.go:68-73` still exposes no ingest route — `/health`, `/metrics`,
`/process-test-message`, `/dead-letter`, `/dead-letter/replay`. #72's chain stands: SDK →
Collector-Go → Kafka → Processor-Go → Postgres.

---

## 1. The counts

| | keys | was @ `b9bf1b5` |
|---|---:|---:|
| RN sends (v3.0.1, excl. the unbounded `user.custom.*`) | **73** | 73 |
| Processor allowlist (`extract.go`, distinct dotted names) | 67 | 38 |
| — plus **14 undotted** error keys (`message`, `is_fatal`, …) RN cannot match | 14 | 0 |
| Name-matched — RN key ∩ allowlist | 32 | 19 |
| — of which **reachable** on a path RN actually sends | **30** | **17** |
| — of which promoted only on a path RN never sends (§4d) | 2 | 2 |
| — of which promoted into a table **no dashboard reads** (§5) | 4 | 0 |
| — **promoted and visible to the product** | **26** | 17 |
| **Bag-only — stored in `attributes`, no column** | **43** | (56 dropped) |
| Allowlist keys RN never sends (columns that stay NULL) | 35 | 19 |

The +13 promoted keys are `device.id`, five `http.*`, four `navigation.*` and three
`screen.*` — RN now reaches **five of the seven** child-table dispatch paths.

### The bag is not a reader

`0002_android_wire_contract.up.sql:3` adds `attributes JSONB NOT NULL DEFAULT '{}'` and `:70-71`
indexes it `USING GIN (attributes jsonb_path_ops)`. Two limits the contract document must
state plainly:

- **`jsonb_path_ops` indexes containment only.** `attributes @> '{"crash.fatal": true}'` uses
  the index; `attributes->>'http.duration_ms'` — every extraction, cast, aggregate and
  percentile — does not. A bag key is cheap to *filter* on and expensive to *measure*.
- **Nothing reads it.** `attributes` appears in **zero** queries across the analytics service
  (`grep -rn attributes app/` returns only pydantic `from_attributes=True`). The bag is
  write-only today.

So "the bag catches it for free" is true of **durability** and false of **visibility**. It
converts a permanent loss into a deferred one — real progress, and not a substitute for
promotion.

---

## 2. The 30 that land

Grouped by the extraction path that reads them. Every path except the metric one is new since
`b9bf1b5`. **"Read by product" is table-level** — it means the analytics service issues queries
against that table, not that every listed column appears in one.

**Context — read on every event** (`service.go:206-218`)

| Key | Read at | Column | Read by product |
|---|---|---|---|
| `app.name` | `extract.go:139` | `rum_apps.name` | ✓ |
| `app.version` | `extract.go:140` | `rum_apps.version` | ✓ |
| `device.id` | `extract.go:151` | `rum_devices.device_id` | ✓ (dedup key, §5) |
| `device.platform` | `extract.go:152` | `rum_devices.platform` | ✓ |
| `device.model` | `extract.go:154` | `rum_devices.model` | ✓ |
| `device.manufacturer` | `extract.go:155` | `rum_devices.manufacturer` | ✓ |
| `device.brand` | `extract.go:156` | `rum_devices.brand` | ✓ |
| `device.fingerprint` | `extract.go:159` | `rum_devices.fingerprint` — RN-Android only | ✓ |
| `device.hardware` | `extract.go:160` | `rum_devices.hardware` — RN-Android only | ✓ |
| `device.product` | `extract.go:161` | `rum_devices.product` — RN-Android only | ✓ |
| `user.id` | `extract.go:166` | `rum_users.user_id` | ✓ |
| `session.id` | `extract.go:175` | `rum_sessions.session_id` | ✓ |
| `session.start_time` | `extract.go:171` | `rum_sessions.start_time` | ✓ |
| `session.duration_ms` | `extract.go:177` | `rum_sessions.duration_ms` | ✓ |
| `session.event_count` | `extract.go:178` | `rum_sessions.event_count` | ✓ |
| `network.type` | `extract.go:184` | `rum_sessions.network_type` | ✓ |

**Metric path** — `frame_render_time`, `memory_usage` (`service.go:240-245`)

| Key | Read at | Column | Read by product |
|---|---|---|---|
| `memory.type` | `extract.go:205` | `rum_performance_metrics.memory_type` | ✓ |
| `memory.source` | `extract.go:206` | `rum_performance_metrics.memory_source` | ✓ |

**`http.request`** (`service.go:256-259`) — the largest single gain

| Key | Read at | Column | Read by product |
|---|---|---|---|
| `http.url` | `extract.go:247` | `rum_http_requests.url` | ✓ |
| `http.method` | `extract.go:248` | `rum_http_requests.method` | ✓ |
| `http.status_code` | `extract.go:249` | `rum_http_requests.status_code` | ✓ |
| `http.duration_ms` | `extract.go:250` | `rum_http_requests.duration_ms` | ✓ |
| `http.success` | `extract.go:251` | `rum_http_requests.success` | ✓ |

`rum_http_requests` is the analytics API's second-most-read table (41 references). The single
most valuable thing that changed since `b9bf1b5` is that RN's HTTP telemetry now arrives
where the dashboards already look.

**`screen.duration`** (`service.go:268-271`) — native only, and only via the explicit
`screenStart`/`screenEnd`/`trackRoute` path (`wire-inventory.md` §8.7)

| Key | Read at | Column | Read by product |
|---|---|---|---|
| `screen.name` | `extract.go:290` | `rum_screen_durations.screen_name` | ✓ |
| `screen.duration_ms` | `extract.go:291` | `rum_screen_durations.duration_ms` | ✓ |
| `screen.exit_method` | `extract.go:292` | `rum_screen_durations.exit_method` | ✓ |

**`navigation`** (`service.go:264-267`) — native only; **written, never read** (§5)

| Key | Read at | Column | Read by product |
|---|---|---|---|
| `navigation.from_screen` | `extract.go:279` | `rum_navigations.from_screen` | ✗ |
| `navigation.to_screen` | `extract.go:280` | `rum_navigations.to_screen` | ✗ |
| `navigation.method` | `extract.go:281` | `rum_navigations.method` | ✗ |
| `navigation.route_type` | `extract.go:282` | `rum_navigations.route_type` | ✗ |

---

## 3. The 43 that stay in the bag

| Namespace | n | Keys | Status |
|---|---:|---|---|
| `user.*` (profile) | 9 | `avatar` `createdAt` `email` `firstName` `fullName` `lastName` `name` `phone` `updatedAt` | **columns exist, no dispatch case** (§4e) |
| `crash.*` | 5 | `breadcrumbs` `cause` `fatal` `message` `stacktrace` | **table exists, RN's names are dotted and the extractor's are not** (§4c) |
| `device.*` | 5 | `androidRelease` `androidSdk` `iosDeviceName` `iosSystemName` `platformVersion` | 3 casing near-misses (§4a); 2 iOS keys have no column |
| `frame.*` | 5 | `dropped_count` `max_ms` `p95_ms` `source` `target_hz` | 7 `frame_*` columns exist, **still zero overlap** (§4b) |
| `http.*` | 4 | `host` `path` `request_size` `response_size` | `request_size`/`response_size` were **deliberately removed** from the insert — the live table has no such columns |
| `memory.*` | 3 | `pressure_level` `unit` `usage_mb` | `unit` is a near-miss on `metric.unit`; the other two are on a path RN never sends (§4d) |
| `sdk.*` | 3 | `error_count` `platform` `version` | ✗ no column anywhere — and `sdk.version` is the whole v4 deprecation story's only discriminator |
| `app.*` | 2 | `buildNumber` `packageName` | casing near-misses (§4a) — `packageName` is still corrupting `rum_apps` (§5) |
| `interaction.*` | 2 | `screen` `type` | `rum_ui_interactions` exists with seven `ui_*` columns; RN's event name and key namespace both miss (§4c) |
| `network.*` | 2 | `isConnected` `previous_type` | only `network.type` reads |
| `app_lifecycle.*` | 1 | `state` | ✗ no column anywhere |
| `event.*` | 1 | `name` | ✗ no column anywhere — the `custom_event` payload |
| `session.*` | 1 | `sequence` | ✗ no column (#59's dedup key) |
| | **43** | | |

**Eight namespaces with no column anywhere is now three** — `sdk.*`, `app_lifecycle.*` and
`event.*`. That headline is retired. What replaces it is worse in a subtler way: five of the
remaining namespaces have a **table and columns already built**, and RN misses them on naming
or on dispatch, not on schema.

---

## 4. Near-misses — where a column exists and the key still misses it

**(a) Five casing-only misses — unchanged since `b9bf1b5`.** The processor is snake_case; RN's
Context block is flattened off the camelCase `DeviceInfo` interface (`telemetry.ts:601-618`).

| RN sends | Allowlist wants | Column, sitting empty |
|---|---|---|
| `app.buildNumber` | `app.build_number` (`extract.go:141`) | `rum_apps.build_number` |
| `app.packageName` | `app.package_name` (`extract.go:142`) | `rum_apps.package_name` |
| `device.platformVersion` | `device.platform_version` (`extract.go:153`) | `rum_devices.platform_version` |
| `device.androidSdk` | `device.android_sdk` (`extract.go:157`) | `rum_devices.android_sdk` |
| `device.androidRelease` | `device.android_release` (`extract.go:158`) | `rum_devices.android_release` |

Five one-line SDK fixes, no backend work, and one of them is actively corrupting a table (§5).

**(b) `frame.*`: seven columns, still zero overlap.** The metric path reads
`frame.build_duration_ms`, `frame.raster_duration_ms`, `frame.type`, `frame.dropped`
(`extract.go:201-204`); the event path adds `frame.total_duration_ms`, `frame.severity`,
`frame.target_fps` (`:220-224`). RN sends `p95_ms`, `max_ms`, `dropped_count`, `target_hz`,
`source` (`adapters/frameAggregate.ts:8-11`). Not one name coincides. `frame.target_hz` vs
`frame.target_fps` remains the same physical quantity one column apart. **This is the map's §7
finding and it survived the re-audit intact** — the vocabulary split is in the code, not in the
stale pin.

**(c) Two namespace misses where the table is already built.** These are new, and they are the
sharpest items on the list.

- **`crash.*` → `rum_errors`.** `service.go:260-263` routes `app.crash` to `extractError`,
  which reads **undotted** keys: `message`, `stacktrace`, `exception_type`, `cause`,
  `error_context`, `user_action`, `error_code`, `crash_thread`, `crash_is_main_thread`,
  `is_fatal`, `handled`, `anr_duration_ms`, `hang_duration_ms`, `screen_name`
  (`extract.go:260-273`). RN sends `crash.message`, `crash.stacktrace`, `crash.cause`,
  `crash.fatal`, `crash.breadcrumbs`. **Zero match.** Every RN crash writes a `rum_errors` row
  with all fifteen payload columns empty — the same hollow row §3 used to describe for
  `rum_performance_events`, reproduced in the errors table. And `rum_errors` is read by nothing
  (§5).
- **`interaction.*` → `rum_ui_interactions`.** The dispatch case is `ui.interaction`
  (`service.go:272`); RN emits `user.interaction`, so it never fires. Even if it did, the
  extractor reads `ui.type`, `ui.target`, `ui.x`, `ui.y`, `ui.direction`, `ui.screen`,
  `ui.name_source` (`extract.go:298-304`) and RN sends `interaction.type`,
  `interaction.screen`. Double miss. **#52 already decided RN retires `user.interaction` for
  `ui.interaction` with six `ui.*` keys — this re-audit shows those columns are already built,
  including `ui_name_source`.** #52's cost estimate ("storage cost today is zero") should now
  read *storage already provisioned*.

**(d) Two keys promoted onto a path RN never sends — same conclusion, different reason.**
`memory.usage_mb` and `memory.pressure_level` are read only by `extractPerformanceEvent`
(`extract.go:217-218`). At `b9bf1b5` the gate was `type: "event"`; at `origin/main` it is
`isPerformanceEventName` (`service.go:252`, `:289-296`), a two-name allowlist —
`frame.summary`, `memory_pressure`. RN emits neither. **RN's own key, in the schema, still
unreachable by RN.**

**(e) `user.profile.update` — the processor is asking RN for this.** RN emits it; the dispatch
switch has no case, so it writes a bare `rum_telemetry_events` row and the analytics-owned
`rum_users.name` / `.email` / `.phone` / `profile_data` columns stay NULL. This is
**follow-up #2 in the processor's own `docs/follow-ups.md`**, and its "Do" step reads: *"Confirm
the exact wire keys the SDK uses for the profile fields first."* The contract document answers
an open backend question here rather than making a request.

**(f) `memory.unit` vs `metric.unit`.** Unchanged (`extract.go:200`,
`memoryNative.native.ts:43`). #53 already decided the SDK will start sending `metric.unit`, so
this near-miss is scheduled rather than open.

---

## 5. Consequences worse than a bag-only key

**Every RN app still collapses into one row.** `0001_init.up.sql:13` creates
`ix_rum_apps_package_name` (unique on `package_name` alone — analytics `000` has no such
index, the processor's additive DDL supplies it), and `repository.go:52` upserts
`ON CONFLICT (package_name) DO UPDATE SET package_name = EXCLUDED.package_name`. RN sends
`app.packageName`, so `stringAttr` returns `""` and **every RN app on the platform, across
every tenant, upserts onto the single empty-string row.** Worse than §4a implies: the
`DO UPDATE` never touches `tenant_id`, so that row is permanently attributed to whichever
tenant inserted it first. One casing fix closes it.

**The per-event device row is fixed on native and still live on web.**
`repository.go:60-70` now selects on `device_id` before falling back to `fingerprint`, and
`0002:73-75` adds a partial unique index on it. Native `device.id` is stable per install, so
RN-iOS finally dedups. **Web `device.id` is regenerated on every event**
(`wire-inventory.md` §8.2), so RN-Web still inserts a fresh `rum_devices` row per event — and
now also evades the collector's per-device rate limiting (#72) and burns a unique index. #69
owns the fix. **#58's and #60's "`device.id` is read nowhere" is retired**: it is a promoted
column, the primary dedup key, ahead of `fingerprint`.

**Promoted into a table nobody queries.** `rum_errors`, `rum_navigations` and
`rum_ui_interactions` are Go-owned tables created by `0002`. Counting `FROM`/`JOIN` across the
analytics service: `rum_sessions` 101, `rum_http_requests` 41, `rum_crash_events` 38,
`rum_screen_durations` 7, `rum_navigation_events` 3 — and `rum_errors` **0**, `rum_navigations`
**0**, `rum_ui_interactions` **0**. The dashboards read `rum_crash_events` and
`rum_navigation_events`, which the processor does not write. This is **follow-up #3** in the
processor repo, and it is a hard dependency for RN crash and navigation visibility: fixing
RN's key names alone would move the data into a table with no reader.

**The silent per-event drop is gone.** `0004_processor_dead_letter_events` plus
`service.go:88-94` capture every non-infrastructure per-event failure with its raw JSON and
error, replayable via `POST /dead-letter/replay`. #56's and #60's "silent drop behind a 2xx"
is closed **for per-event failures**. Two batch-level paths still commit the offset with only a
`WARN` — an unparseable envelope and a missing `tenant_id` (`service.go:73-79`) — which is
processor follow-up #1, and the collector's six whole-batch loss modes (#72) sit upstream of
Kafka and are untouched.

---

## 6. What this hands the contract document

The persuasive number changed and so did the ask. **"17 of 73 dropped" is retired — do not
cite it.**

1. **Lead on 26 of 73 visible, 43 in a bag nothing reads.** The bag is real progress (no key
   is lost) and it is not a query surface: `jsonb_path_ops` indexes containment only, and the
   analytics service issues zero queries against `attributes`. Promotion is still the ask; the
   consequence of not promoting has softened from *destroyed* to *invisible*.
2. **Android's contract is implemented, not proposed.** Reference it, do not restate it. Every
   `ui.*`, `navigation.*`, `screen.*` and trace column #54/#52/#51 chose already exists as a
   column, so the v4 asks are a **delta against a shipped schema**.
3. **Five one-line casing wins, still open**, one of them merging every RN app into one row.
   Separate them from the v4 ask — they need no schema change and no backend release.
4. **`frame.*` is still the §7 evidence, unchanged**: seven columns, zero overlap, two names
   for one quantity.
5. **Two naming misses have their tables already built** — `crash.*` must become the undotted
   keys the extractor reads, and `user.interaction` must become `ui.interaction` (#52). Both
   are blocked behind processor follow-up #3 for *visibility*, since the tables they land in
   have no reader.
6. **Answer the backend's open question about `user.profile.update`** (follow-up #2) rather
   than requesting a column.
7. **Trace columns exist; `traceparent.outcome` does not.** `rum_telemetry_events` carries
   `trace_id`, `span_id`, `parent_span_id`, `rum_action_id`, `trace_root_type`,
   `span_start_time`, `span_duration_ms` — exactly #54's key names — plus the
   `rum_action_envelopes` view (`0002:96-106`). But #65's outcome ladder has no column, and the
   live `rum_http_requests` carries **`trace_injection` as an enum** plus `trace_adopted bool`.
   **#65's open question is answered in the harder direction: an enum exists, so a new outcome
   value is a migration.** #67 must ask either for the enum's labels to cover the seven-value
   ladder or for the column to be text.
8. **`sdk.version` as a column is confirmed missing.** #69's ask stands: ten v4 breaks are
   separable only by a key that lives in the bag and in no column.
9. **Geo has a landing place.** The analytics API reads `rum_geo_locations` 15 times and
   `rum_http_requests` carries `geo_location_id`. The collector computes a geo block from the
   client IP and the processor discards it (#72). #67's free `location` claim now has a named
   table and a named column.
10. **`http.request_size` / `http.response_size` are bag-only by decision, not by omission.**
    The conformance work removed them from the insert because the live table has no such
    columns. Asking for them is asking the analytics team for DDL.

---

## Appendix A — regenerate the counts

Run from the RN repo root, with the processor clone at `$P`. `wire-inventory.md`'s Appendix B
supplies the RN half; this pairs it with the allowlist.

```bash
P=/Users/mktowett/Development/Windsurf/EDGETELEMETRYPROCESSORGO   # @ 516a02f (origin/main)
git -C "$P" checkout 516a02f

# (1) processor allowlist — 67 distinct dotted names
grep -oE '"[a-z_]+\.[a-z_.]+"' "$P/internal/telemetry/extract.go" \
  | tr -d '"' | sort -u > /tmp/allowlist.txt

# (2) RN's 73 keys — verbatim from wire-inventory.md Appendix B
{
  grep -rhoE "[\"'][a-z][a-zA-Z0-9_]*(\.[a-z][a-zA-Z0-9_]*)+[\"'][[:space:]]*(:|\][[:space:]]*=)" \
    src --include='*.ts' --exclude='*.test.ts' \
    | sed -E "s/[\"'][[:space:]]*(:|\][[:space:]]*=)\$//; s/^[\"']//"
  awk '/^export interface (DeviceInfo|NetworkInfo)/,/^\}/' src/core/telemetry.ts \
    | awk '
        /^export interface NetworkInfo/            { p="network"; next }
        /^    (app|device):[[:space:]]*\{/         { p=$1; sub(":","",p); next }
        /^    \};?$/                               { if (p!="network") p=""; next }
        p && /^ +[a-zA-Z]+\??:/                    { k=$1; sub(/\??:.*/,"",k); print p"." k }
      '
} | sort -u > /tmp/rnkeys.txt

wc -l < /tmp/allowlist.txt                        # 67
wc -l < /tmp/rnkeys.txt                           # 73
comm -12 /tmp/rnkeys.txt /tmp/allowlist.txt | wc -l   # 32 name-matched  (30 reachable, §4d)
comm -23 /tmp/rnkeys.txt /tmp/allowlist.txt | wc -l   # 41 no name-match (+2 unreachable = 43 bag-only)
comm -13 /tmp/rnkeys.txt /tmp/allowlist.txt | wc -l   # 35 columns RN never fills
```

Three traps, the first two inherited from `wire-inventory.md` Appendix B:

- **Drop the `:` / `] =` anchor** and event names (`app.crash`, `http.request`, …) contaminate
  the RN set — they appear as `log("app.crash", …)` and as bare `ALLOWED_NAMES` members, never
  followed by a colon.
- **Drop part (b)** and all 19 `app.*` / `device.*` / `network.*` Context keys vanish, because
  they are never string literals — the flattener derives them from interface property names.
  That path is also exactly why they are camelCase, and therefore why five of them miss (§4a).
- **The dotted grep misses `extractError` entirely.** Its fourteen keys are undotted
  (`message`, `is_fatal`, `anr_duration_ms`, …) so they never appear in `allowlist.txt`. They
  are not a coverage gap in the arithmetic sense — RN cannot match them either way — but
  leaving them out of the count would hide §4c.

Reachability is not derivable from `comm` alone: a name-match only lands if the event reaches
the extractor that reads it. The dispatch is `service.go:240-279` — metric path, then
`isPerformanceEventName` (`frame.summary` / `memory_pressure` only), then `http.request`,
`app.crash|app.anr|app.hang`, `navigation`, `screen.duration`, `ui.interaction`, then a
`default` that writes the envelope row and stops.

Visibility is not derivable from the processor at all. Count readers in the analytics service:

```bash
A=/Users/mktowett/Development/PycharmProjects/edge_telemetry_rum_analytics   # @ 264732f
grep -rhoE "(FROM|JOIN) rum_[a-z_]*" "$A/app" | sed -E 's/^(FROM|JOIN) //' \
  | sort | uniq -c | sort -rn
grep -rn "attributes" "$A/app" | grep -v from_attributes    # empty — the bag has no reader
```
