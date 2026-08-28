# Coverage gap — how many RN keys the processor actually reads

**Answer: 17 of 73. Fifty-six keys — 77% of everything the SDK sends — are parsed into memory
and thrown away.**

The failure mode is silence. An unlisted key is not rejected, not logged, not counted. The
POST returns 2xx, the event row is written, and the payload that made the event worth sending
is simply never looked up.

**Sources, pinned.** SDK: `NCG-Africa/edge_telemetry_react_native` @ `99e1d7f` (v3.0.1),
key set per [`docs/wire-inventory.md`](./wire-inventory.md). Processor:
`NCG-Africa/EDGETELEMETRYPROCESSORGO` @ `b9bf1b5`, local clone at
`/Users/mktowett/Development/Windsurf/EDGETELEMETRYPROCESSORGO`. Every `file:line` below is
against those two commits. Regenerate the counts with [Appendix A](#appendix-a--regenerate-the-counts).

---

## 1. The counts

| | keys |
|---|---:|
| RN sends (v3.0.1, excl. the unbounded `user.custom.*`) | **73** |
| Processor allowlist (`extract.go`, distinct dotted names) | 38 |
| Name-matched — RN key ∩ allowlist | 19 |
| — of which **reachable** on the path RN actually uses | **17** |
| — of which promoted only on a path RN never sends (§4) | 2 |
| **Dropped — RN sends it, nothing reads it** | **56** |
| Allowlist keys RN never sends (columns that stay NULL) | 19 |

The 38-key allowlist is the *whole* extraction story, not a first pass. `Attributes` is
touched in exactly two places: the four `extract*` calls at `service.go:107-119` and the
literals in `extract.go`. Nothing else in the repo reads the map, and **no table has a JSONB
bag** (`internal/db/migrations/0001_init.up.sql`, seven `rum_*` tables, every column scalar).
There is no second chance and no landing zone.

```
$ grep -rn "Attributes" --include='*.go' internal/ | grep -v _test.go | wc -l
20      # 4 in service.go, 15 in extract.go, 1 struct field in domain/telemetry.go
```

---

## 2. The 17 that land

| Key | Read at | Column |
|---|---|---|
| `app.name` | `extract.go:138` | `rum_apps.name` |
| `app.version` | `extract.go:139` | `rum_apps.version` |
| `device.platform` | `extract.go:147` | `rum_devices.platform` |
| `device.model` | `extract.go:149` | `rum_devices.model` |
| `device.manufacturer` | `extract.go:150` | `rum_devices.manufacturer` |
| `device.brand` | `extract.go:151` | `rum_devices.brand` |
| `device.fingerprint` | `extract.go:154` | `rum_devices.fingerprint` — **RN-Android only** (§5) |
| `device.hardware` | `extract.go:155` | `rum_devices.hardware` — RN-Android only |
| `device.product` | `extract.go:156` | `rum_devices.product` — RN-Android only |
| `user.id` | `extract.go:161` | `rum_users.user_id` |
| `session.id` | `extract.go:170` | `rum_sessions.session_id` |
| `session.start_time` | `extract.go:166` | `rum_sessions.start_time` |
| `session.duration_ms` | `extract.go:172` | `rum_sessions.duration_ms` |
| `session.event_count` | `extract.go:173` | `rum_sessions.event_count` |
| `network.type` | `extract.go:179` | `rum_sessions.network_type` |
| `memory.type` | `extract.go:200` | `rum_performance_metrics.memory_type` |
| `memory.source` | `extract.go:201` | `rum_performance_metrics.memory_source` |

Seventeen keys, and **fourteen of them are Context-block identity** — who, which device, which
session. Of RN's actual *measurements*, exactly **two** survive: `memory.type` and
`memory.source`, the two least informative attributes on the least reliable event the SDK has
(`memory_usage` fires at most once per process, and usually zero times — `wire-inventory.md`
§8.6). Every number RN measures is dropped. The metric `value` itself does land, in
`rum_performance_metrics.value` — but it is the bare `event.Value` field, not an attribute,
and it arrives with no unit and no name-scoped context beside it.

---

## 3. The 56 that land nowhere

Grouped by namespace. **Namespaces marked ✗ do not exist in the allowlist at all** — not one
key, and no table to hold them.

| Namespace | n | Keys | Status |
|---|---:|---|---|
| `http.*` | 9 | `duration_ms` `host` `method` `path` `request_size` `response_size` `status_code` `success` `url` | ✗ no namespace |
| `user.*` (profile) | 9 | `avatar` `createdAt` `email` `firstName` `fullName` `lastName` `name` `phone` `updatedAt` | only `user.id` reads |
| `device.*` | 6 | `androidRelease` `androidSdk` `id` `iosDeviceName` `iosSystemName` `platformVersion` | 3 are casing near-misses (§4) |
| `crash.*` | 5 | `breadcrumbs` `cause` `fatal` `message` `stacktrace` | ✗ no namespace |
| `frame.*` | 5 | `dropped_count` `max_ms` `p95_ms` `source` `target_hz` | 7 `frame.*` columns exist, **zero overlap** (§4) |
| `navigation.*` | 4 | `from_screen` `method` `route_type` `to_screen` | ✗ no namespace |
| `sdk.*` | 3 | `error_count` `platform` `version` | ✗ no namespace |
| `screen.*` | 3 | `duration_ms` `exit_method` `name` | ✗ no namespace |
| `network.*` | 2 | `isConnected` `previous_type` | only `network.type` reads |
| `app.*` | 2 | `buildNumber` `packageName` | casing near-misses (§4) |
| `interaction.*` | 2 | `screen` `type` | ✗ no namespace |
| `app_lifecycle.*` | 1 | `state` | ✗ no namespace |
| `event.*` | 1 | `name` | ✗ no namespace — this is the `custom_event` payload |
| `memory.*` | 1 | `unit` | near-miss against `metric.unit` (§4) |
| `session.*` | 1 | `sequence` | — |
| | **56** | | |

Read that column of ✗s as the actual finding. **Eight entire namespaces have no column
anywhere**, and they are not the marginal ones — they are HTTP, crashes, navigation, screens,
interactions, lifecycle, custom events and the SDK's own self-report. Everything the product
exists to show a customer is in that list.

The rows are not lost, only hollowed out. `service.go:141-144` routes every `type: "event"` to
`CreatePerformanceEvent`, so an `http.request` writes a `rum_performance_events` row with
`event_name = 'http.request'` and **all eight payload columns NULL** — memory and frame
columns that an HTTP request was never going to fill. The database can tell you how many HTTP
requests happened. It cannot tell you the URL, the status, or how long one took.

### `custom_event` is the sharpest single case

`log()` rewrites any non-allowlisted name to `custom_event` and moves the original into
`event.name` (`src/core/telemetry.ts`, `ALLOWED_NAMES`). `event.name` is dropped. So **every
custom event a consumer emits collapses into one indistinguishable row type** — the whole
public `log()` surface, the API the integration guide leads with, arrives as an
undifferentiated count.

---

## 4. Near-misses — where a column exists and the key still misses it

Not every drop needs a new column. Three classes below already have somewhere to land and miss
anyway, which makes them the cheapest fixes on the list and the most embarrassing to leave.

**(a) Five casing-only misses.** The processor is snake_case throughout. RN's Context block is
flattened straight off the `DeviceInfo` interface (`telemetry.ts:601-618`), which is
camelCase — so the key never matches, though the concept and the column both exist:

| RN sends | Allowlist wants | Column, sitting empty |
|---|---|---|
| `app.buildNumber` | `app.build_number` | `rum_apps.build_number` |
| `app.packageName` | `app.package_name` | `rum_apps.package_name` |
| `device.platformVersion` | `device.platform_version` | `rum_devices.platform_version` |
| `device.androidSdk` | `device.android_sdk` | `rum_devices.android_sdk` |
| `device.androidRelease` | `device.android_release` | `rum_devices.android_release` |

`app.packageName` is not a cosmetic loss — see §5.

**(b) `memory.unit` vs `metric.unit`.** RN puts the unit in its own namespace
(`memoryNative.native.ts:43`). `extract.go:195` reads `metric.unit`. So
`rum_performance_metrics.unit` is NULL on every RN row, and the one number that does land —
`value` — lands unitless.

**(c) `frame.*`: seven columns, zero overlap.** The allowlist's frame vocabulary is
build/raster/total duration, type, severity, dropped, target_fps — Flutter's per-frame model,
exactly. RN aggregates: p95 over a 10s window, max, dropped count, target Hz
(`adapters/frameAggregate.ts:8-11`). Not one name coincides. `frame.target_hz` vs
`frame.target_fps` is the same physical quantity under two names, one column apart.

This is the map's §7 finding in miniature: **the allowlist is a union of whatever shipped
first, not a contract.** The one place RN is privileged rather than absent is `memory.usage_mb`
(`extract.go:212`), which is RN's key and no other SDK's — and RN cannot reach it either, for
the reason below.

**(d) Two keys promoted onto a path RN never sends.** `memory.usage_mb` and
`memory.pressure_level` are read only inside `extractPerformanceEvent`, which
`service.go:141-144` reaches only for `type: "event"`. RN emits `memory_usage` through
`logMetric` (`memoryNative.native.ts:40`, `telemetry.ts:588`), so it arrives as
`type: "metric"` and routes to `extractPerformanceMetric` — which reads neither. **RN's own
key, in the schema, unreachable by RN.** These are the 2 that separate the 19 name-matches
from the 17 that land.

---

## 5. Two consequences worse than a dropped column

Both fall out of §4's near-misses. They are not coverage gaps — they are active corruption of
the tables that *do* fill.

**Every RN app collapses into one row.** `rum_apps` carries
`CREATE UNIQUE INDEX ix_rum_apps_package_name ON rum_apps (package_name)`
(`0001_init.up.sql:9`), and `repository.go:52` upserts `ON CONFLICT (package_name)`. RN sends
`app.packageName`, never `app.package_name`, so `stringAttr` returns `""` — not NULL, so the
`NOT NULL` passes — and **every RN app on the platform, across every tenant, upserts onto the
single row whose `package_name` is the empty string.** App-level segmentation does not exist
for RN today. Fixing one casing mismatch fixes it.

**A new device row per event on iOS and web.** `CreateOrGetDevice` dedups on `fingerprint`
alone (`repository.go:59-68`); an empty fingerprint skips the SELECT and falls straight to the
INSERT. RN populates `device.fingerprint` only on Android
(`deviceInfo.native.ts:43`, gated `Platform.OS === "android"`, and only when the optional
`react-native-device-info` peer is installed); on iOS and web it is `undefined` and
`JSON.stringify` omits it. So **every single event from an RN-iOS or RN-Web client inserts a
fresh `rum_devices` row** — unbounded growth on the hottest write path, and a device count that
is really an event count. `device.id`, which would be the natural dedup key, is read nowhere
(§3).

**Flagged, not resolved — hand to [#72](https://github.com/NCG-Africa/edge_telemetry_react_native/issues/72):**
`repository.go:50` inserts `tenant_id` into `rum_apps`, and `0001_init.up.sql` declares no such
column. At `b9bf1b5` these disagree. If the deployed schema matches the migration, every insert
errors, `classifyRepoError` returns non-infrastructure, and `service.go:65-71` does
`slog.Warn` + `continue` — a **silent per-event drop behind a 2xx**, for all four SDKs, not
just RN. Whether the live deployment carries an out-of-band migration is #72's question, since
it also decides whether this Kafka-consuming processor is even the artifact serving RN's HTTP
endpoint. RN sends no `tenant_id` of its own (asserted by `webSender.test.ts:36`,
`nativeSender.test.ts:48`), so something in front must stamp it — `service.go:59` discards an
entire batch without one.

---

## 6. What this hands the contract document

1. **Lead on 17 of 73.** It is the persuasive number, and the reason is not disagreement about
   what matters — it is that no one ever wrote the columns down. Eight namespaces have nowhere
   to land.
2. **The bag-first ask is proven, not argued.** No JSONB anywhere means every key added after
   a backend release is invisible until the next one. The five casing misses show the failure
   is silent even when both sides already agree on the concept.
3. **Five one-line wins exist today** (§4a) and one of them (`app.package_name`) is currently
   merging every RN app into a single row. Worth calling out separately from the v4 ask —
   they need no new schema.
4. **`frame.*` is the §7 four-way-split evidence, quantified**: seven columns, zero overlap,
   two names for one quantity.
5. **`memory.usage_mb` is the counter-example that proves the rule** — RN's key is in the
   schema and RN still cannot reach it, because promotion happened per-path rather than per-key.

---

## Appendix A — regenerate the counts

Run from the RN repo root, with the processor clone at `$P`. `wire-inventory.md`'s Appendix B
supplies the RN half; this pairs it with the allowlist.

```bash
P=/Users/mktowett/Development/Windsurf/EDGETELEMETRYPROCESSORGO   # @ b9bf1b5

# (1) processor allowlist — 38 distinct dotted names
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

wc -l < /tmp/allowlist.txt                        # 38
wc -l < /tmp/rnkeys.txt                           # 73
comm -12 /tmp/rnkeys.txt /tmp/allowlist.txt | wc -l   # 19 name-matched  (17 reachable, §4d)
comm -23 /tmp/rnkeys.txt /tmp/allowlist.txt | wc -l   # 56 dropped
comm -13 /tmp/rnkeys.txt /tmp/allowlist.txt | wc -l   # 19 columns RN never fills
```

Two traps, both inherited from `wire-inventory.md` Appendix B and both real:

- **Drop the `:` / `] =` anchor** and event names (`app.crash`, `http.request`, …) contaminate
  the RN set — they appear as `log("app.crash", …)` and as bare `ALLOWED_NAMES` members, never
  followed by a colon.
- **Drop part (b)** and all 19 `app.*` / `device.*` / `network.*` Context keys vanish, because
  they are never string literals — the flattener derives them from interface property names.
  That path is also exactly why they are camelCase, and therefore why five of them miss (§4a).

The allowlist grep returns 40 lines before `sort -u`: `frame.build_duration_ms` and
`frame.raster_duration_ms` each appear twice, once per extraction path
(`extract.go:196-197` and `:215-216`).
