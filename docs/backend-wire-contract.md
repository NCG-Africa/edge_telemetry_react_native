# React Native → Backend Wire Contract

**What `@nathanclaire/edge-telemetry-sdk` sends in v4, key by key, and what the backend must store.**

Addressed to the team authoring `edge_db`'s schema. It is written so you can author schema from it
without asking us a question — with one deliberate exception, §0.3, where we have a question for you.

---

## Pins

Every `file:line` in this document is against one of these five, named at the citation:

| Artifact | Pin | Role |
|---|---|---|
| `NCG-Africa/edge_telemetry_react_native` | **`4f92c16`** (v3.0.1; non-test `src/` unchanged since `1eb1b10`) | this SDK |
| `NCG-Africa/EDGETELEMETRYCOLLECTORGO` | `20a8470` | terminates the SDK's POST |
| `NCG-Africa/EDGETELEMETRYPROCESSORGO` | **`516a02f`** (`origin/main`, 2026-08-30) | Kafka consumer → Postgres |
| `NCG-Africa/edge_telemetry_rum_analytics` | `264732f` | owns the live schema; issues the dashboard queries |
| live `edge_db` | introspected **2026-09-03**, PostgreSQL 18.1 | the actual schema |

**The live schema is the authority, not any migration file.** It is a merge of three sources —
analytics migrations, the processor's additive `IF NOT EXISTS` DDL, and out-of-band DDL in neither
repository (`schema_migrations` reports version **5** against **four** migrations in the processor
repo). Reading either repo's SQL and calling it the schema is what produced two broken inserts
already. Full dump: [`docs/introspection/edge-db-live-schema.md`](./introspection/edge-db-live-schema.md).

Two companion documents, both cited throughout and both reproducible:
[`docs/wire-inventory.md`](./wire-inventory.md) (what v3 sends, `file:line`, per build) and
[`docs/coverage-gap.md`](./coverage-gap.md) (where a v3 key lands today).

---

## 0. How to read this

### 0.1 Routing table

| You are… | Read | Skip |
|---|---|---|
| **Sizing tables / capacity planning** | §1.3, §2.3, §9.4, §12.5 | everything else |
| **Writing DDL for the analytics schema** | §1.2 items tagged `ANALYTICS`, §8 (owner column), §10 | §4–§7 detail |
| **Changing `extract.go` / the processor** | §1.2 items tagged `PROC`, §8, §4.9 (the undotted↔dotted map), §11.2 | §3, §12 |
| **Building dashboards on RN data** | §4, §5, §6.6, §7, §10, and every ⚠ box | §1.2, §8 |
| **Deploying for a bank / on-prem customer** | §11 | everything else |
| **Reconciling RN against the Android contract** | §7, §13 (five departures), §6.7 | §8 |
| **Wondering why a column is empty** | §10 first, then §8 | — |
| **Migrating a v3 dashboard** | §9, §12 | — |

### 0.2 Conventions

- **`COL`** — the key belongs in a typed column. **`bag`** — it belongs in
  `rum_telemetry_events.attributes` (JSONB, GIN `jsonb_path_ops`) and nowhere else.
- **Owner tags.** `SDK` = we change. `PROC` = `EDGETELEMETRYPROCESSORGO`. `ANALYTICS` =
  `edge_telemetry_rum_analytics`, which owns the live schema. **RN cannot get a column by asking the
  processor team**, and the processor's `CREATE TABLE IF NOT EXISTS` is a no-op against a table
  analytics already created. The split is per key, not per topic.
- **Status.** `already shipped` = the column exists live and is verified in the 2026-09-03 dump.
  `new ask` = it does not. `deliberately bag` = we are not asking, and the promotion trigger is named.
- **Absence is total, with exactly one exception.** An absent key means the SDK had nothing —
  encode that rule once. v3's two `?? null` keys, `crash.message` and `crash.stacktrace`, are
  retired by §4.7, so the rule holds across the whole v4 surface **except `navigation.from_screen`**,
  which still ships a literal `null` on the first `screenStart` and rides an event already deprecated
  for removal in v5 (§4.11). One nullable column, on a table you should not be building new
  dashboards on anyway.
- **Every SDK-authored key matches `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$`.** Snake_case under a
  dotted namespace, no exceptions. **Consumer-supplied keys are exempt** and pass through verbatim —
  `log(event, data)`'s payload and `user.custom.*`. Expect arbitrary casing **in that slice of the
  bag and nowhere else**; the Context block contains no consumer keys at all, so the assertion is
  total.

### 0.3 The one question running backwards

Everything else in this document is a statement. This is not:

> **`rum_http_requests.trace_injection` is a live enum, `public.trace_injection_outcome`, whose six
> labels are defined in neither repository. Three of them contradict or re-partition the SDK's
> documented behaviour. §6.5 states what RN will send and what we believe the resolution should be —
> but we need your call on `injected_inbound_malformed`.**

Details and the exact conflict: §6.5. Population is **0 of 1,390,117 rows**, so redefining it costs
no migration.

---

## 1. The ask, in one page

### 1.1 The model change, stated first

`rum_telemetry_events.attributes JSONB` already exists and `service.go:230-235` stores **every**
attribute in it, so **nothing RN sends is discarded at ingest any more**. That is real progress and
it is not a query surface: `jsonb_path_ops` indexes **containment only** — `attributes @> '{"ui.rage":
true}'` uses the index; `attributes->>'http.duration_ms'` and every cast, aggregate and percentile
does not. And `attributes` appears in **zero** queries across the analytics service.

So the failure mode moved from *silence at ingest* to *silence at query time*. The ask is not
"catch our keys" — you already do. **The ask is that fifteen specific keys become columns, one table
gets created, and four routing/naming defects get fixed.** Everything else RN sends is
`deliberately bag`, with its promotion trigger written down, so no bag row reads as a backlog item.

RN's ask is **smaller than Android's**, deliberately. Android's contract went to a team that owned
its schema; this map measured what unread promotion is worth and found the control experiment —
four `navigation.*` keys that are promoted, filled, and land in a table **no dashboard queries**
(`rum_navigations`, 25 rows, 0 analytics readers, against `rum_navigation_events` at 583,907). A key
gets `COL` here only if this document can **name the query that needs it as a column**.

### 1.2 The work list

Ordered so the first item is free.

| # | Owner | Ask | DDL | § |
|---|---|---|---|---|
| 1 | `PROC` | **Geo — answer a precedence question, then persist.** The collector computes a full MaxMind block and attaches it at `handler.go:112-113` (`GEO_ENABLED` default **true**, `config.go:100`); the processor has **zero** `geo` references and drops it. Meanwhile an out-of-band IP path already fills `rum_geo_locations` (18 rows) and stamps `geo_location_id` on **348,516** http rows — but `geo_source` is `'ip'` on every one, and **0 of 67 RN-web rows have geo at all**. State which source wins, and why web is uncovered. | none | §8.6 |
| 2 | `ANALYTICS` | **Create `rum_views`** — the one new table. Ten columns, §4.5. | `CREATE TABLE` | §4.5 |
| 3 | `ANALYTICS` | **`ALTER TABLE rum_ui_interactions ADD ui_rage bool, ADD ui_dead bool`** | 2 `ALTER` | §4.6 |
| 4 | `PROC` | **Route `app.crash` / `app.error` to `rum_crash_events`** (`stack_trace TEXT`, **38 analytics readers**), *not* `rum_errors` (`stacktrace VARCHAR(2000)`, **0 readers, 7 rows**). And read the **dotted** `error.*` keys — mapping table at §4.9. Today `extractError` reads undotted keys, so every RN crash writes a row with all fifteen payload columns empty. | none | §4.7 |
| 5 | `PROC` | **Build the `user.profile.update` dispatch case.** This is your own follow-up #2, answered: the exact wire keys are `user.name` / `user.email` / `user.phone` / `user.custom.*`, upserting `rum_users` on `user_id`. All three columns are read across **six** analytics repositories including two `ILIKE` paths and a trigram index, and all three are **NULL in production today**. | none | §4.10 |
| 6 | `ANALYTICS` | **Promote `sdk.version`** to a column on `rum_telemetry_events`. It is the *only* discriminator for twenty v3→v4 breaks — and it is absent from the bag on **4,145,161 of 4,146,233** historical rows, so a migration note telling consumers to split on it is telling them to split on a key their data does not have. | 1 column + index | §12 |
| 7 | `ANALYTICS` | **Promote `app.build_id`** to a column. Symbolication join key; a join key in a bag nothing queries is inert. | 1 column | §4.8 |
| 8 | `ANALYTICS` | **Promote `event.sequence`, add `UNIQUE (session_id, event_sequence)`, make the insert `ON CONFLICT DO NOTHING`.** v4 is at-least-once. `rum_telemetry_events` has no natural key, no unique index and no `ON CONFLICT` (`repository.go:109-117`), so a replayed batch is **new rows, silently** — inflating every aggregate by exactly the traffic that had trouble getting through. | 1 column + unique index | §2.4 |
| 9 | `PROC`+`ANALYTICS` | **`traceparent.outcome`: retype `trace_injection` from the enum to `VARCHAR`; deprecate `trace_adopted` as derivable.** And answer §0.3. | 1 type change | §6.5 |
| 10 | `ANALYTICS` | **Promote `view.id`, `view.name`, `http.host`, `http.route`.** Named readers in §8. `http.route` in particular replaces `rum_http_requests.url`, which §9.1 empties. | 4 columns | §8 |
| 11 | `PROC` | **`extract.go:166` must use `stringAttrMax`.** `device.id` is capped at 255 (`:151`); `user.id` is read **uncapped** into `rum_users.user_id VARCHAR(255)`. Under §3.2 `user.id` becomes consumer-supplied, so an over-long id is SQLSTATE 22001 → `slog.Warn` + `continue`. Migration `0003_widen_device_identity` exists because that exact failure already happened in production. | none | §3.2 |
| 12 | `ANALYTICS` | **`rum_sessions.user_id` nullable, and `CreateOrGetUser` skips empty.** §3.2 omits `user.id` on anonymous traffic, so `CreateOrGetUser("")` mints one empty-string row and every anonymous session's `NOT NULL` FK points at it — a `JOIN rum_users` on an anonymous session then returns a row that looks like a real user. | 1 nullable | §3.2 |
| 13 | `ANALYTICS` | **Session aggregates become a query-time view.** `repository.go:94-99` upserts `ON CONFLICT (session_id) DO UPDATE SET session_id = EXCLUDED.session_id` — a **no-op** — so the row is fixed by the first event bearing the id, always `session.started`, and `duration_ms` is **NULL forever** / `event_count` **0 forever**, for all four SDKs. No SDK change fixes this. Derive instead. | none | §4.2 |
| 14 | `PROC` | **Cap the `user.*` reads at 255 / 255 / **50**.** `rum_users.phone` is `VARCHAR(50)`. Same asymmetry as #11; failure mode is the whole profile silently lost behind a 2xx. | none | §4.10 |
| 15 | `PROC` | **Drop the `memory.timestamp` read.** `extract.go` extracts it into `rum_performance_events.memory_timestamp` — a key no SDK has ever emitted, on a table RN does not write to. The envelope `timestamp` is authoritative. | none | §5.2 |

**Reported, not requested** — four facts you should know and that RN is not asking you to fix:

- **`CreateOrGetDevice`'s fingerprint fallback merges handsets.** `repository.go:59-81` falls back
  to `fingerprint` when `device_id` misses — which is **precisely the insert path**, on every
  brand-new device. `Build.FINGERPRINT` is a *build* string shared by every handset on that
  model+build, so it does not occasionally merge, it merges **every** new Android handset into the
  first one seen on that build. RN fixes its half **by sending less** (§3.3 deletes the key, so
  `info.Fingerprint == ""` and `repository.go:71` is skipped, at a cost of **zero** analytics
  readers). Android still sends one and is still exposed.
- **`rum_devices.platform` carries case-split duplicates** — `Android`/`android`, `iOS`/`ios` —
  halving every platform-grouped chart. RN sends `Platform.OS`, lowercase, always.
- **Trace ids are `bpchar(32)` on `rum_http_requests` and `varchar(32)` on `rum_telemetry_events`.**
  Same logical id, two physical types, across the join.
- **`app.packageName` is actively corrupting `rum_apps`, and RN fixes it in `3.1.0`, ahead of v4.**
  See §9.3 — including the fact that **it does not migrate history**.

### 1.3 The three numbers

| | v3.0.1 | v4 |
|---|---:|---:|
| Distinct attribute keys | **73** | **125** — 52 carried over, 73 new, 21 retired |
| Event names produced | 11 events + 2 metrics | 13 events + 7 metrics |
| Allowlist delta | — | **net zero** (+4 / −4), but **four names need sign-off**: `view`, `ui.interaction`, `app.error`, `app.start` |

Reproduce the v3 side with Appendix A. The v4 side is an enumeration of this document's own tables,
not a grep of code that does not exist yet — Appendix A says how to re-derive it from here.

---

## 2. Envelope and transport

### 2.1 What RN sends

```
POST <endpoint>
Content-Type: application/json
X-API-Key: edge_...
Authorization: Bearer edge_...        ← new in v4, §11.1

{ "type": "telemetry_batch", "timestamp": "<ISO 8601>", "batch_size": 13, "events": [ … ] }
```

Built by `adapters/batch.ts:5-12`, shared verbatim by both senders, so the two POST bodies are
byte-identical. **The envelope is closed at these four fields.** There is no top-level `location`,
and there will not be: an envelope-level field is invisible to the per-event `beforeSend` hook
(§3.6), which would make it the wire's most sensitive value with the wire's only missing scrubbing
hatch. Coarse geo is derived server-side from the request IP anyway (§8.6). RN also sends **no
`tenant_id`** — that is correct; the collector stamps it (§2.2).

⚠ **`batch_size` is parsed and never read** (`domain/telemetry.go:17` is its only non-test
occurrence). It is decorative. Do not describe it as validated.

### 2.2 What actually arrives — the envelope you author against is not the one we send

```
RN SDK ──POST /telemetry, X-API-Key──► Collector-Go (routes.go:40, handler.go:72-155)
       ──Kafka `telemetry-upsert`, value = {timestamp, data:<batch>}──► Processor-Go
       ──one transaction per event (service.go:106)──► Postgres edge_db
```

The processor exposes **no ingest route** (`main.go:64-67` is `/`, `/health`, `/metrics`,
`/process-test-message`, `/dead-letter`, `/dead-letter/replay`). The collector hop is not optional.

The collector adds two things the SDK never sent, and nests the whole batch under `data`:

| Added | Where | Note |
|---|---|---|
| `tenant_id` | body in `api_key` mode (`handler.go:131-133`), Kafka header in `jwt` mode (`:124-130`) | this is why RN sends none |
| `geo` | `handler.go:112-113`, MaxMind, `GEO_ENABLED` default true | **destroyed on arrival** — `domain.TelemetryBatch` has no `Geo` field. Work-list item 1. |

⚠ **The `geo` block is PII the SDK provably cannot reach.** It is attached **after `beforeSend` has
run and after the request has left the device**, so a consumer who scrubs perfectly still ships
country / region / city / lat / lng derived from their user's IP. The only lever is the collector's
deployment-level `GEO_ENABLED`. RN takes **no position on granularity** — the analytics API reads
all six fields (`country_code` 14×, `lat`/`lng` 10× each, `region`/`city` 7×, `accuracy_radius` 5×)
and coarsening would break shipped product. Disclosed, not proposed.

### 2.3 Collector limits, so nobody re-litigates §12.5's defaults against an imagined ceiling

Per-key, nothing is lost: `sanitizeMap` (`validator.go:69-92`) is a recursive pass-through that
strips NULs and truncates strings and **never filters a key**. Whole-batch, six ways:

| Limit | Value | v4 |
|---|---|---|
| `device.id` present | **400** for the whole batch if absent (`handler.go:91-98`) | **a delivery precondition**, not a data-quality rule — §3.2 |
| Rate limit, keyed on `device.id` | burst **10 req/s**, 100/min per device, 600/min per IP, 60 000/min per tenant (`config.go:78-86`) | §12.5's drain must pace; it 429s at batch 11 otherwise |
| `MAX_REQUEST_BYTES` | 1 MiB | v4's 50-event batches clear it ~20× over |
| `MAX_BATCH_SIZE` | 1000 events | clears |
| `MAX_EVENT_SIZE_BYTES` | 100 KiB | `error.breadcrumbs` at 1–2 KB clears it ~50× |
| String truncation | **10 000 runes, unmarked** (`validator.go:94-101`) | no v4 key reaches it; live under a consumer-controlled `custom_event` payload |

⚠ **A tenant-less batch is lost permanently and silently.** `service.go:59` logs and returns
`0, nil` — a *nil error* — so `consumer.go:75` commits the offset. Only `ErrInfrastructure`
withholds a commit. Unreachable for collector-originated traffic, but worth naming because when it
fires the failure is total and invisible. The `0004` dead-letter machinery covers per-*event*
failures, not this.

### 2.4 Delivery is at-least-once, and that is the ask behind work-list item 8

v3 lost data silently and the backend could not tell. v4 inverts it: **the SDK is duplicate-tolerant
and self-describing**, and it needs one column from you to stay correct.

- **`flush()` now drains.** In v3 it splices `batchSize` and sends **once** (`telemetry.ts:634-638`)
  — at the shipped defaults a 200-event backlog drained in **~17 minutes**, and `shutdown()` flushed
  two events and abandoned the rest (`telemetry.ts:665-668`). v4 loops, sequentially (one
  transaction per event upstream; parallel batches are how a cold backend gets stampeded by a
  replay), stopping on the first failure, capped at 50 batches per invocation.
- **Unload is persist-then-send on both builds.** The persist is the guarantee — `localStorage` is
  *synchronous*, which is the only step actually guaranteed against a tab close. The `keepalive`
  send is the optimization, budgeted at **60 KB** because the Fetch spec's 64 KiB keepalive allowance
  is **shared across all in-flight keepalive requests**, not per request. Triggers are
  `visibilitychange → hidden` primary, `pagehide` secondary, **never `beforeunload`** (unfired on
  mobile Safari, and it disqualifies bfcache).
- **Replay flips to send-then-remove.** v3 `removeItem`s *before* sending (`nativeSender.ts:70-72`,
  `webSender.ts:72-73`), so a death in that window destroys the entire store.

All three produce duplicates. **`event.sequence`** — a per-session monotonic ordinal on the Context
block — is what makes them free, and it does two jobs:

- **Dedup key**: `(session.id, event.sequence)`.
- **Loss ordinal**: **gaps are loss, duplicates are replay.** This is the inverse of
  `session.sequence`, whose gaps are impossible (§3.5) — which is why it is a new key rather than a
  redefinition.

Without the unique index, at-least-once inflates every count, crash-free rate and percentile by
exactly the traffic from bad networks and dying tabs. The bias runs the wrong way.

### 2.5 A 4xx drops the batch

v3 collapses every non-2xx into one `throw` (`webSender.ts:36`, `nativeSender.ts:33`), retries 3× and
persists. Composed with the stop-on-first-failure drain, **a wrong credential is terminal, not
degraded**: the drain halts at batch 1 on every launch forever while the store fills to its cap and
drop-oldest begins evicting. v4:

| Status | Behaviour |
|---|---|
| **4xx** (401/403 auth, 400 `device.id` gate) | **drop the batch — no retry, no persist**; `sdk.drop_reason = rejected`; one `__DEV__` warn |
| **429** | requeue and halt the drain, honouring `X-RateLimit-Reset` (`handler.go:210-214`) |
| **5xx / network** | unchanged — retry, then persist |

⚠ **A 401 is invisible to the backend by construction** — the report cannot be sent to the thing that
will not authenticate it. The only server-side record is the collector's
`audit.LogAuthenticationAttempt(false, …)` (`handler.go:167`). No telemetry key will ever carry it.

---

## 3. The Context block — 39 keys on every event and metric

Built by `collectContext()` (`telemetry.ts:527-575`), called by both `log()` (`:493`) and
`logMetric()` (`:585`). There are no standalone `device_info` / `network_info` events.

### 3.1 Attribution freezes at span start

This is new in v4 and it changes what a Context key on a span *means*.

In v3, `http.request` is logged in the interceptor's `finally` (`interceptFetchNative.native.ts:37-61`)
and `log()` collects Context at call time (`telemetry.ts:493`) — so **every request describes the
view it landed in, not the one it started in.**

| Key | Resolved at |
|---|---|
| `session.id`, `session.start_time`, `view.id` | **span start (frozen)** |
| `trace.id`, `span.id`, `parent.span.id`, `rum.action.id`, `trace.root_type` | span start (already, by construction) |
| `view.name` | **log time, by lookup on the frozen `view.id`** — the current best name of the view this row is already pinned to |
| `network.*`, `device.orientation`, device state | log time — a request that failed because the network dropped is better described by the network at completion |
| `user.*` | log time — a mid-flight `identify()` should land the identity we know now |
| `session.sequence`, `event.sequence` | log time — transmission ordinals, not attribution |
| everything else | log time |

`session.id` freezing is not optional: §4.2's 4-hour cap can rotate a session **while a request is in
flight**, which would otherwise put S1's trace on an S2 row and break the invariant §6.6 tells you
you can assert on. Point events (`app.crash`, `custom_event`, `app_lifecycle`, `network_change`,
`user.profile.update`, metrics) have no span, so the freeze is a no-op on them.

### 3.2 Identity — two keys, two owners

**`user.id` is a union type in v3 with nothing on the wire to discriminate it.** It is minted
anonymously at construction (`telemetry.ts:192`, generator `:344`) and then *overwritten* by
`setUserProfile({userId})` (`:366-368`) — so `rum_users.user_id` holds `user_1749…_a3f9…` for one app
and `cust-88213` for the next, in one column, and no query separates a visitor from a customer.
Persisting the mint would have made that column stable and left it ambiguous.

| | `device.id` | `user.id` |
|---|---|---|
| Owner | SDK | **consumer** |
| Value | `device_{ms}_{16hex}_{Platform.OS}`, self-minted | whatever the app passes, **truncated to 255 at source** |
| Lifetime | persisted, uninstall-scoped, **never rotates** — not on login, not on logout | set on identify, cleared on `clearUserProfile()` |
| Anonymous traffic | always present | **omitted** |
| `beforeSend` tier | **B** — rewritable, not deletable, *and* a delivery precondition | **C** — free |

**Anonymous reach is `COUNT(DISTINCT device.id)`. Known-user reach is `COUNT(DISTINCT user.id)`.**
Neither is answerable in v3. And because `device.id` is stable across the login transition,
**anonymous→known stitching is `GROUP BY device.id`** — free, and impossible in v3 where the only
stable-ish id was the one being overwritten.

Three things this forces on you:

1. **`rum_sessions.user_id` must go nullable** and `CreateOrGetUser` must skip empty — work-list 12.
2. **`extract.go:166` must cap** — work-list 11.
3. **Identity is read per-event from the bag, never from `rum_sessions`.** `repository.go:109-120`
   is a no-op upsert, so `rum_sessions.user_id` is fixed by the first event bearing that session id.
   A user who signs in at minute three is anonymous on their session row forever; a user who signs
   **out** stays bound to it, which is the worse direction. This is not something the SDK can work
   around, and §4.2 applies the same "derived wins" rule to session aggregates.

`device.id` is **self-minted, not `getUniqueId()`**. The decider is that `getUniqueId()` already
carries two lifetimes on RN alone — ANDROID_ID survives reinstall, `identifierForVendor` does not —
so one identity column would already mean two things. It also matches what Android puts in that same
column (`IdGenerator.kt:57-67` mints `device_{ms}_{hex}_android` into `SharedPreferences`).

**`device.id_ephemeral`** (bool, Context, **absent means false**) flags the population where storage
was unavailable — incognito, a partitioned iframe, Safari ITP eviction, a full disk — and the id was
minted once per process instead of persisted. It earns its slot because it is **not derivable
query-side**: an ephemeral id appears once and never returns, indistinguishable from a real device
installed and uninstalled the same day, and without the flag that population inflates
`COUNT(DISTINCT device_id)` and reads as **traffic growth**.

Entropy moves from `Math.random()` to `crypto.getRandomValues` — for one import line, because
`react-native-get-random-values` is already a hard dependency that is **never imported**. A persisted
`device.id` collision is permanent where a session collision was transient: two handsets merge into
one `rum_devices` row and one rate-limit bucket, forever.

### 3.3 The 39 keys

`✱` = new in v4. `N` = native only. `W` = web only. Storage verdicts and owners: §8.

| Key | Type | Null? | Cardinality | Note |
|---|---|---|---|---|
| `user.id` | string ≤255 | **omitted** when anonymous ✱ | per user | §3.2 |
| `session.id` | string | never | per session | `session_{ms}_{16hex}_{Platform.OS}` — **web gains `_web`** ✱ |
| `session.start_time` | ISO 8601 | never | per session | |
| `session.sequence` | int | never | small | ⚠ **the name lies** — §3.5 |
| `session.sample_rate` ✱ | float 0.0–1.0 | never | ~1 per deployment | §3.6. **Absent ⇒ assume 1.0** |
| `event.sequence` ✱ | int | never | per event | §2.4. Stamped **after** `beforeSend` |
| `sdk.platform` | string | never | 3–5 | **`react-native-{Platform.OS}`** ✱ — value change, §12 |
| `sdk.version` | string | never | per release | **promote** — work-list 6 |
| `sdk.events_dropped` ✱ | int, monotonic | never | small | §3.7 |
| `sdk.drop_reason` ✱ | string | **omitted** until one occurs | **3** — `queue_full`\|`store_full`\|`rejected` | §3.7 |
| `sdk.hook_dropped` ✱ | int, monotonic | never | small | §3.6 — the hook **working** |
| `sdk.hook_failed` ✱ | int, monotonic | never | small | §3.6 — the hook **broken** |
| `app.name` | string | never | low | |
| `app.version` | string | never | per release | |
| `app.build_number` | string | **omitted** when unset | per build | **respelled** from `app.buildNumber` ✱ |
| `app.package_name` | string | never | low | **respelled** ✱ — §9.3 |
| `app.build_id` ✱ | string | **omitted when unset, never `""`** | per bundle | consumer-supplied. §4.8 |
| `device.id` | string | never | per install | §3.2 |
| `device.id_ephemeral` ✱ | bool | **omitted when false** | 1 (`true`) | §3.2 |
| `device.platform` | string | never | **3** — `ios`\|`android`\|`web`, lowercase | |
| `device.platform_version` | string | never | dozens / hundreds | **respelled** ✱ |
| `device.model` | string | never | native hundreds · **web thousands** | ⚠ web sends the full user-agent — §7.3 |
| `device.manufacturer` | string | never | native dozens · web const `"browser"` | |
| `device.brand` | string | never | native dozens · web ~4 | |
| `device.android_sdk` `N` | string | absent off-Android | ~15 | **respelled** ✱ |
| `device.android_release` `N` | string | absent off-Android | ~15 | **respelled** ✱ |
| `device.hardware` `N` | string | absent off-Android | dozens | |
| `device.product` `N` | string | absent off-Android | hundreds | |
| `device.ios_system_name` `N` | string | absent off-iOS | 1 | **respelled** ✱ |
| `device.cpu_abi` ✱ `N` | string | never | ~5 | "does this crash only on cheap devices" |
| `device.low_ram` ✱ `N` | bool | never | 2 | as above |
| `device.screen_density` ✱ | float | never | ~10 | CLS and LCP scale with viewport |
| `device.screen_width_px` ✱ | int | never | ~100s | as above |
| `device.screen_height_px` ✱ | int | never | ~100s | as above |
| `device.orientation` ✱ | string | never | 2 | Context, not fault-only — CLS, dwell and interactions all split by it |
| `network.type` | string | never | native ~7 · **web effectively 1** | ⚠ §7.3 |
| `network.is_connected` | bool | **omitted** when undefined on native | 2 | **respelled** ✱ |
| `view.id` ✱ | string | never | per view | `view_{ms}_{16hex}`. Frozen at span start |
| `view.name` ✱ | string | never | ~100s | **best-effort here; authoritative on the `view` event** — §4.5 |

**Deleted from the Context block in v4 (12 keys plus a namespace):** `user.name`, `user.email`,
`user.phone` **move** to `user.profile.update` (§4.10); `user.fullName`, `user.firstName`,
`user.lastName`, `user.avatar`, `user.createdAt`, `user.updatedAt`, `device.fingerprint`,
`device.iosDeviceName` are **gone outright** (§3.4); `user.custom.*` **moves** and is bounded.

**Overwrite order matters and is unchanged.** `collectContext` assembles device → network → caller
`data` → identity keys → profile. So **caller `data` cannot override the identity keys** but **can
override any `app.*`, `device.*` or `network.*` key**. `log("x", {"device.model": "spoof"})` ships.

### 3.4 What left the Context block, and why

| Key | Disposition | Reason |
|---|---|---|
| `user.name` / `.email` / `.phone` | → `user.profile.update` only | PII shipping on **every** event to populate a per-user upsert table that needs it **once**. A 10 000-event session put 10 000 copies of an email on the wire and at rest. Copies per session go N → 1. Self-healing: the profile is in-memory, so `identify()` re-fires every launch. |
| `user.fullName` | **deleted** | exact duplicate of `user.name` — both written from `identify().name` (`telemetry.ts:558-559`). `user.name` survives: v3 key, Android key, column name. |
| `user.firstName` / `.lastName` / `.avatar` | **deleted** | no column, no reader anywhere; `identify()` could never set the first two. |
| `user.createdAt` / `.updatedAt` | **deleted** | not timestamps of anything. `userProfile` is **in-memory only** (`telemetry.ts:169`, no storage path), so `createdAt` means *"first `identify()` this process"* and resets every launch — and since `setUserProfile` stamps `updatedAt` on every call and `createdAt` only when new, the two are **byte-identical every session** for any one-`identify()` app. Also the only two ms-epoch ints in the payload. First-seen is `MIN(created_at)` backend-side. |
| `user.custom.*` | → `user.profile.update`, bounded | per-*user* data on a per-*event* channel. Consumers already have `log(event, data)` for per-event dimensions. **This closes the per-event bag key space completely** — after v4 every key on a normal RN event comes from a fixed, enumerable set, which is the property that lets this document promise you an indexable bag. |
| `device.fingerprint` | **deleted** | see §1.2 "reported, not requested". Zero analytics readers; deleting it *repairs* device identity. |
| `device.iosDeviceName` | **deleted** | the user's own name for their phone ("Ada's iPhone"). Real PII, no column, no reader. |

### 3.5 ⚠ `session.sequence` — do not build gap detection on it

It is stamped at `collectContext` time (`telemetry.ts:551`) but incremented only **after a 2xx flush**
(`:642`). So it counts *batches acknowledged before this event was logged* — not a batch index and
not an event ordinal. A permanently failed batch never increments it, so the next batch's events
**repeat** the value, and offline replay delivers values out of order.

**Gaps are impossible. Duplicates are the loss signal.** It is kept for iOS parity and it is
`deliberately bag`. If you promote it, the caveat travels with the column. `event.sequence` (§2.4) is
the key that answers "was anything lost".

### 3.6 `beforeSend` and `sessionSampleRate` — what the host can change

Both ship on **both builds**, in shared `core/telemetry.ts`, **constructor-only** (a runtime setter
leaves a window between init and registration where `session.started`, the launch trace root and the
early `http.request`s all land).

**`beforeSend(event) => event | null`** — one event, **sync**, at **enqueue time, not flush**.
Enqueue-time is the actual security answer: a failed send persists the batch to
`AsyncStorage`/`localStorage`, so a flush-time hook would let unscrubbed PII **hit disk**, and on
native that disk survives app restarts. Sync because `app.crash` must flush during teardown and a
Promise-returning hook puts a host `await` in a dying app's path. It covers **metrics too** — the
Context rides every metric, and `vital.target` is a raw CSS selector.

Three tiers, **enforced by re-stamping, never by throwing**, because the realistic hook is
`delete attrs[k]` in a loop and the failure mode is **over-deletion, not malicious rewrite**:

| Tier | Keys | Why |
|---|---|---|
| **A — immutable** | `type`, `eventName`/`metricName`, `timestamp`, `session.id`, `session.start_time`, `event.sequence`, all `sdk.*`, **all `app.*`**, `device.platform`, `trace.id`, `span.id`, `parent.span.id`, `rum.action.id`, `view.id` | no scrubbing use case — and a writable `eventName` would restore the public path to `app.crash` that §4.7 removes on purpose |
| **B — rewritable, not deletable** | `device.id` | hashing to a tenant-local id is legitimate; deleting it 400s the batch at the collector |
| **C — free** | everything else — `user.*`, `http.*`, `view.name`, `error.*`, `ui.target`, `vital.target`, `user.custom.*`, all caller `data` | where the PII actually lives |

**Throwing fails closed** — sending the original would ship the exact field the hook existed to
remove. Two **separate** counters ride the Context block, because "my volume is 40% down" needs to
distinguish *my rule is too broad* (`sdk.hook_dropped`) from *my rule is crashing*
(`sdk.hook_failed`); one merged counter answers neither.

**`sessionSampleRate` is sticky per session**, re-rolled at each rotation, persisted across process
death (a resume is not a rotation, or a relaunch produces a **half-sampled session**), and **never
per-event** — per-event sampling punches holes that make §4.5's three view counters wrong by a random
factor per view.

**A sampled-out session sends nothing at all.** No skeleton record: web tabs never finalize, so a
skeleton would arrive with no counts attached, i.e. unable to carry the one metric it exists for.
Comparability is restored by **`session.sample_rate` on the wire** instead — extrapolation becomes
arithmetic, and it survives a consumer retuning mid-quarter, which config-in-a-spreadsheet does not.

⚠ **Crashes do not bypass sampling.** The tempting exception destroys §4.7: 100% of crashes over 10%
of sessions makes the unfiltered crash-free query read **10× too high, permanently**, with no `WHERE`
available to repair it. Numerator and denominator are sampled identically, so crash *rate* stays
correct for free and crash *count* extrapolates via `session.sample_rate`.

⚠ **Every query counting sessions, crashes or events across deployments must divide by
`session.sample_rate`.**

### 3.7 ⚠ The loss counters are lossy about their own loss

`sdk.events_dropped` and `sdk.drop_reason` only arrive if a **later** event gets through. The tab
that closes and never returns reports nothing; it surfaces on that device's next session. Alerting on
the number under-reports exactly when things are worst. `event.sequence`'s gaps are what actually
cover this.

---

## 4. Events, key by key

Every event carries §3 **plus** the keys listed. `eventName` outside the allowlist is rewritten to
`custom_event` with the original name in `event.name` (`telemetry.ts:490-494`).

### 4.0 The allowlist

| Name | v3 | v4 | Note |
|---|---|---|---|
| `session.started` | ✓ | ✓ | |
| `session.finalized` | ✓ | ✓ | |
| `app.start` | — | **+ new, sign-off** | §4.3 |
| `app_lifecycle` | ✓ | ✓ | |
| `view` | — | **+ new, sign-off** | §4.5 |
| `navigation` | ✓ `N` | ✓ `N` **deprecated** | remove v5 |
| `screen.duration` | ✓ `N` | ✓ `N` **deprecated** | remove v5 |
| `http.request` | ✓ | ✓ | §4.4 |
| `app.crash` | ✓ | ✓ | §4.7 |
| `app.error` | — | **+ new, sign-off** | §4.7 |
| `ui.interaction` | — | **+ new, sign-off** | §4.6 |
| `user.interaction` | ✓ `N` | **− retired** | Android's contract already tells you not to build a table for it |
| `network_change` | ✓ `N` | ✓ `N` | |
| `user.profile.update` | ✓ | ✓ | §4.10 |
| `custom_event` | ✓ | ✓ | |
| `page_load` | allowlisted, **never produced** | **− retired** | §5.3 — its job is done three times over |
| `resource_timing` | allowlisted, never produced | **− retired** | §10.2 |
| `long_task` | allowlisted, never produced | **− retired** | §10.2 |
| `frame_render_time` | metric | metric | §5.1 |
| `memory_usage` | metric | metric `N` | §5.2 — **web drops it entirely** |
| `LCP` `FCP` `CLS` `INP` `TTFB` | allowlisted, never produced | **metrics** `W` | §5.3 |

**Net zero, four names to sign off.** Anything not on the list is dropped on ingest, so the four are
a hard dependency.

⚠ **Web's event surface is greenfield, not a compatibility constraint.** In v3 the web build emits
only `session.started`, `session.finalized` (idle rotation only — a closed tab never finalizes),
`app_lifecycle`, `http.request`, `app.crash`, `user.profile.update`, `custom_event` and
`frame_render_time`. It does **not** emit `navigation` — `index.web.ts:120` calls `inst.start(...)`,
a method `Telemetry` does not have, and the `TypeError` is swallowed by a fire-and-forget `.catch`,
so `NavigationTrackerWeb` has **never once run**. Web's entire new surface in v4 is `view.*` plus the
vitals, and web's entire name-level sign-off is **one name**: `view`.

### 4.1 `session.started` — both builds

| Key | Type | Cardinality | Note |
|---|---|---|---|
| `session.reason` ✱ | string | **3** — `launch`\|`idle`\|`max_duration` | |
| `device.locale` ✱ | string | ~50 | `session.started` only — a cohort property nobody slices a *crash* by |
| `device.timezone` ✱ | string | ~40 | as above. **Tier C** — a coarse geolocation proxy |
| `sdk.trace_allowlist_size` ✱ | int | small | **count only, never the hosts** — §6.4 |

**A resumed session does not re-emit `session.started`**, or `COUNT(session.started)` stops equalling
session count.

### 4.2 `session.finalized` — both builds, and its payload is discarded on arrival

| Key | Type | Note |
|---|---|---|
| `session.duration_ms` | int | stamped from `lastActivity`, not `now` |
| `session.event_count` | int | |
| `sdk.error_count` | int | |
| `session.reason` ✱ | string | **2** — `idle`\|`max_duration` |

⚠ **`rum_sessions.duration_ms` is NULL forever and `event_count` is 0 forever, for all four SDKs,
and no SDK change fixes it.** `repository.go:94-99` upserts `ON CONFLICT (session_id) DO UPDATE SET
session_id = EXCLUDED.session_id` — a no-op — so the row is fixed by the *first* event bearing that
id, always `session.started`, which carries neither.

**So session aggregates are a query-time derivation, and the derived value is authoritative**
(work-list 13): `duration_ms = MAX(timestamp) − start_time`, `event_count = COUNT(*)` over
`rum_telemetry_events`. Three things fall out free: it is **self-healing under offline replay**
(a write-time aggregate is wrong by construction when a batch lands hours late); it is the **only**
source that works for the web sessions that never finalize, which after §4.2's continuity change is
most of them; and it fixes the v3 defect where a lazily-checked rotation reports **6 hours** for
2 minutes of use after 6 idle hours.

Same rule drops five more as derivable: `session.metric_count`, `session.screen_count`,
`session.visited_screens`, `session.is_first_session`, `session.total_sessions`. RN sends none of
them. **Android's two counter keys are redundant with the same derivation** — reported, not proposed.
`session.finalized` survives as the carrier for `session.reason` and `sdk.error_count`, neither of
which is derivable.

**Session boundaries in v4:**

| | v3 | v4 |
|---|---|---|
| Idle | 30 min | **30 min, unchanged** — the window drives session *counts*, and all four SDKs write one `rum_sessions`, so a per-SDK value makes "sessions per user" incomparable. Android and iOS are both 30. |
| Maximum length | none | **4 hours** ✱ — new, and neither sibling has one. Earned because removing the process-death boundary lets a backgrounded app's `http.request` traffic hold one session open forever. Bounds *length*, not *count*. |
| Process death / tab close / hard reload / bfcache restore | ends the session | **resumes**, if inside the idle window ✱ |
| Lifecycle rotation | native rotated on foreground, finalized on background | **neither build rotates on a lifecycle transition** — parity reached by *deletion* ✱ |
| Web scope | per page | **`localStorage`, browser-wide, shared across tabs** ✱ |

⚠ **v4 session counts drop sharply against v3.** RN native processes are killed constantly and in v3
every kill mints a session. Do not compare a v4 number to a v3 one. Two tabs also now share one
`session.id`, which raises "views per session" on web relative to native.

### 4.3 `app.start` ✱ — both builds, cold only

| Key | Type | Null? |
|---|---|---|
| `app.start.js_ready_ms` | int ms | **nullable** — Old Architecture, or where the platform omits the marker |

A bare per-process marker. It exists because two decisions left a hole *between* them: the launch
trace root rides `app.start` (§6.2), and §4.2 made sessions resume across process death without
re-emitting `session.started` — so an app relaunched inside the idle window would otherwise mint **no
launch root at all**, for the most common real pattern there is, and `session.reason: launch` would
**undercount launches invisibly**, because the rows that would reveal it are the ones never emitted.

**Count app launches from `app.start`, not from `session.reason`.**

⚠ **`js_ready_ms` is deliberately not `duration_ms`.** `performance.rnStartupTiming` gives a
natively-anchored process-start marker with no native module, but it ends at **bundle evaluated**
where Android's `app.start` ends at **first Activity resume**. Same-named numeric columns always get
compared, so the key is renamed rather than aligned. There is no `app.start.type`: RN's JS context
survives backgrounding, so a warm start never re-initialises the SDK — `app.start` is cold-only by
construction, and a `type` key would be cardinality-1 waste.

### 4.4 `http.request` — both builds

| Key | Type | Null? | Cardinality | Note |
|---|---|---|---|---|
| `http.method` | string | never | ~8 | **uppercased in the shared builder** ✱ — §9.5 |
| `http.status_code` | int | never; **`0` on transport failure** | ~40 | ⚠ below |
| `http.duration_ms` | int | never | unbounded | |
| `http.success` | bool | never | 2 | |
| `http.host` | string | **omitted** on a native relative URL | dozens | keeps the **port** — deliberately unlike §6.4's gate |
| `http.route` ✱ | string | never | ~100s | **normalized template**, §4.4.1 |
| `http.request_size` | int | **omitted when unmeasurable, never 0** ✱ | unbounded | **true UTF-8 bytes** ✱ |
| `http.response_size` | int | **omitted when unmeasurable; a real 0 now ships** ✱ | unbounded | |
| `traceparent.outcome` ✱ | string | **absent = not traced** | **7** | §6.5 |

**Removed: `http.url` and `http.path`.** §9.1.

⚠ **`http.status_code = 0` means the call never got a response** — DNS, TLS, timeout, cancellation.
Treat it as a distinct failure bucket, never folded into 5xx. RN collapses abort / timeout / network
error into it on both builds and does not invent a discriminator, because Android lumps them too and
documents it — inventing an RN-only `http.error_kind` would break the borrow-Android posture to fix a
cross-SDK condition. **One RN-specific note for dashboard authors:** screen unmounts cancel in-flight
requests constantly, so `status_code = 0` on RN carries a much larger share of *correct app
behaviour* than the same bucket does on Android.

**`http.request_size` in v3 was `String.length` — UTF-16 code units, not bytes** — and only for
string bodies, so `FormData`, `Blob`, `ArrayBuffer` and `URLSearchParams` uploads reported nothing,
with absence indistinguishable from "no body". v4 measures every type measurable **without consuming
it**: strings by byte count, `ArrayBuffer`/`TypedArray` by `.byteLength`, `Blob` by `.size`.
`FormData` and streams stay **omitted** — an SDK that drains a consumer's request body is a far worse
bug than a missing key. ⚠ **Any non-ASCII traffic's payload-size series steps up 2–3× on upgrade with
no code change behind it.**

**Capture coverage — claimed positively, then enumerated.** Native goes **XHR-only** in v4: on React
Native `global.fetch` **is** `XMLHttpRequest` (`setUpXHR.js:27` → `whatwg-fetch` →
`new XMLHttpRequest()` at `fetch.umd.js:540`, RN 0.81.4), so XHR is not a second channel but the one
*underneath* the channel v3 already patched. Patching both would emit **two events per `fetch()`
call**. One chokepoint catches fetch *and* axios.

> **Native captures all JS-originated HTTP** — `fetch` and `XMLHttpRequest`, therefore axios, and
> therefore effectively every JS HTTP client. Web keeps its `fetch` patch on top, because browser
> `fetch` is native and not XHR-backed.

Outside that boundary, **invisible and uncountable**: `react-native-blob-util` / `rn-fetch-blob`, RN
Firebase, Apollo with a native link, `expo-updates`, `expo-file-system` downloads, `Image` loading,
`WebSocket` (a native module, not XHR), and on web `sendBeacon` / `EventSource`. These are **absent
from `traceparent.outcome`'s denominator**, not counted as unattributed. There is no warning to
build: you cannot emit a warning about requests you can never see.

⚠ **This is the largest volume change in v4 and the multiplier framing is wrong.** For a
`fetch`-based app volume is **unchanged**. For an **axios-based app it goes from zero to
everything.** Today an unknown fraction of RN tenants write **no rows at all** to
`rum_http_requests`. After v4, effectively every tenant does. **Size the table as if all RN apps
report HTTP, and treat any per-tenant baseline drawn from v3 RN data as worthless for the axios ones
— their baseline is zero, so there is nothing to extrapolate.** There is deliberately no per-request
cap: HTTP rows get *aggregated*, and a capped tail is indistinguishable from a healthy one, so the
corruption of error-rate and latency percentiles would be invisible. The lever, if volume proves
real, is `sessionSampleRate` — which preserves percentiles by construction because it drops whole
sessions rather than the slow requests within one.

**Invariant you can assert on: `http.request` never contains the collector endpoint.**

#### 4.4.1 The normalization rule — SDK-side only, and nothing raw ever leaves the device

The processor does **no** normalization, needs no normalization code, never re-derives, and never
receives a raw path to rewrite *from*.

```
name = "/" + segments.map(s => isVariable(s) ? "{id}" : s).join("/")

isVariable(s):
  1. /^v\d+$/i.test(s)   → false   // version carve-out: /v2/ survives
  2. /\d/.test(s)        → true    // any digit
  3. s.length >= 32      → true    // opaque all-alpha token / dashless UUID
  otherwise              → false

depth capped at 6 segments; deeper truncated with a trailing "/…"
"/" stays "/";  no case folding;  trailing slash dropped
```

Three deliberate choices. **`{id}`, not Datadog's `?`** — OTel's `http.route` is the neutral
precedent where Android has no analogue, and `?` reads as a query-string sigil inside a value that is
*almost* a URL. **No cardinality guard** — a client-side rolling collapse would make one row mean
different things on different phones. **Accepted residue:** `/accounts/savings`, an all-alpha slug
identifying one account, survives as itself; guessing harder would eat `/settings/privacy`.

⚠ **`http.route`, not a normalized `http.path` — and the reason is a collision you are about to be
able to prevent or bake in permanently.** If RN shipped a normalized value in `http.path` while
Android ships the raw path in the same-named key, one column would hold two dialects: `GROUP BY
http.path` a working endpoint query for RN rows and a cardinality explosion for Android rows, in the
same chart, with nothing in the data to separate them. That is exactly the `app.packageName` failure
(§9.3) rebuilt on purpose. Android's `http.path` stays raw and uncontaminated; RN's normalized values
get their own column; a cross-SDK query needs a deliberate `COALESCE` — a **visible** seam instead of
a silent one.

### 4.5 `view` ✱ — both builds, emitted once, at view exit

A View is carried two ways: **`view.id` + `view.name` on the Context block** of every event, metric,
error and span, and **the other ten keys on one `view` event at exit**. `view.name` is denormalized
deliberately, so "errors by screen" and "p95 by screen" need no join.

| Key | Type | Null? | Cardinality | Note |
|---|---|---|---|---|
| `view.host` | string | **omitted on native** | 1–10 | origin only. Earns its place on white-label banking: one bundle serving `bank-a.com` and `bank-b.com` |
| `view.referrer` | string | never — **`""` on the first view**, not null | ~100s | previous `view.name`. Adopts Android's convention |
| `view.load_type` | string | never | **4** — `initial_load`\|`route_change`\|`resume`\|`session_rotation` | |
| `view.name_source` | string | never | **4** — `explicit`\|`route`\|`url`\|`none` | §4.5.1 |
| `view.loading_time` | int ms | **yes** — and null has four causes | measure | §4.5.2 |
| `view.loading_time_outcome` | string | **never null** | **4** — `settled`\|`no_activity`\|`capped`\|`abandoned` | §4.5.2 |
| `view.time_spent` | int ms | never | measure | **foreground-only dwell** |
| `view.error_count` | int | never | measure | `app.crash` + `app.error` — a **closed enumeration**. Not resource failures, not failed requests, not `console.warn` |
| `view.action_count` | int | never | measure | `ui.interaction` rows sharing the `view.id` |
| `view.request_count` | int | never | measure | **all** `http.request` in the view, **failures included**, collector POST excluded |

**Lifetime — four boundaries.** A view ends, emits, and mints a successor on: **route change**,
**background**, **session rotation**, and **process death** (which ends the view but, since §4.2,
*not* the session). So **`view.id` never spans a `session.id` and never spans a process, even though
`session.id` now does** — and a killed view's dwell is **lost**, since no `view` event was ever
emitted for it. The initial view **opens at SDK init**, so `view.id` is never absent and the launch
action's root span always has a view.

**One screen visit can produce several `view` rows.** Sum by `view.name`. That is the price of the
real win: the event flushes while the app is reliably alive rather than pending through an OS kill or
a tab close.

⚠ **`view` is authoritative for dwell. `screen.duration` becomes a deprecated compatibility feed**
(remove in v5), and **its volume goes *up* in v4** — see §4.11. Do not size `rum_screen_durations`
from v3 traffic, and do not build new dashboards on it.

⚠ **Straddling actions.** `COUNT(DISTINCT rum_action_id) WHERE view_id = X` is **not** "actions in
view X" — it is "actions with at least one span in X", and an action that straddles a boundary is
counted in **both** views. `view.action_count` is unaffected (it counts rows, which carry the
mint-time view). §6.3.

#### 4.5.1 `view.name` — a three-rung ladder, and the URL rule is the *last* rung

React Navigation *authors* the web URL (`linking.getPathFromState`), and `getCurrentRoute()` is a
navigation-tree API that works identically on RN-Web. So a digit heuristic reading `/dashboard/1234`
is reverse-engineering a template the app is holding in memory — and losing to it. Worse, the answer
it discards is **the same string native already sends** (`route.name`), so one `GROUP BY view.name`
spanning both builds is available for free. `attachNavigation` moves to `TelemetryBase` in v4.

| Rung | `view.name_source` | Source | Normalized? |
|---|---|---|---|
| 1 | `explicit` | host called `screenStart(name)` | **no** |
| 2 | `route` | React Navigation `getCurrentRoute().name`, **both builds** | **no** |
| 3 | `url` | §4.4.1's rule — history-only web (react-router, plain `pushState`) | yes |
| — | `none` | not yet resolvable; `view.name` is the literal `"unknown"` | — |

Rungs 1 and 2 are **never** normalized: a host naming a screen `"Step 2 of 3"` must not receive
`"Step {id} of {id}"`. **Rank beats order; order breaks ties** — a higher rung re-stamps the name
regardless of arrival order, but never mints a new view and never changes `view.id`.

⚠ **`view.name` is therefore mutable within a view's lifetime.** Events emitted in the upgrade window
— typically single-digit milliseconds, between the route event and a mount effect — carry the
lower-rung name in their Context block.

> **Rule: the `view` event's `view.name` is authoritative. The Context-block copy is a best-effort,
> join-free convenience and may differ for events at the very start of a view.** `view.name_source`
> on the `view` event reports the **final** rung. Because the name resolves at log time by lookup on
> the frozen `view.id` (§3.1), a row can never carry a name that disagrees with its own id.

**There is no `view.url`, and no `trackViewUrl: 'full'` knob.** Query-stripping does not address the
threat — the identifier lives in the *path* (`/accounts/GB29-NWBK-6016-1331-9268-19`) — and a
normalized URL is a lie shaped like a URL: it cannot be pasted into a browser, and it is
`view.host + view.name` concatenated. The escape hatch is rung 1, where a host who wants raw URLs
calls `screenStart(rawUrl)` and owns that decision explicitly. `beforeSend` cannot serve here: a
scrubber deletes, it cannot restore what was never captured.

⚠ **Stated plainly, because it is the real cost: no per-request and no per-view URL survives anywhere
on the wire, at any SDK setting. "Which exact account produced this 500" is not answerable from RN
telemetry.**

#### 4.5.2 `view.loading_time` — network settle, one definition, both builds

```
loading_time = t(last qualifying request completed) − t(view start)
```

Scoped to exactly one job: **p75 route-change responsiveness by `view.name`, compared across
releases.** That framing licenses a crude stable heuristic over a clever one, and makes a **null
strictly better than a plausible guess** — a wrong-but-believable 300 ms poisons a release comparison
silently.

**Network-only.** DOM-mutation quiet was rejected as meaningless under React's routine re-rendering;
rAF quiet never settles against RN's animation driver. In-flight `fetch`/XHR is the one signal both
builds genuinely have, so web and native run the **same shared module** rather than one column name
over two meanings.

- **Quiet window 1000 ms, subtracted back out** — it is detection delay only, free because the event
  emits at view *exit*, not at settle. A request starting during an already-quiet period does not
  reopen the view, or a 30-second poller re-arms forever.
- **Hard cap 30 s**, and a capped view emits **null, not the cap**. Release comparison reads **two**
  series: p75 where `outcome = 'settled'`, and **% `capped`**. A spike at exactly the cap makes 30 s
  and 90 s the same row.
- **Zero-network is `null`, never `0`.** A `0` makes p75 track the *cache-hit rate*, so a backend
  caching win renders as a frontend regression, reversed.
- **Scope is everything except the SDK's own collector POST.** The user waits on third-party widgets
  too. First-party-only has no native definition, and reusing §6.4's *security* allowlist as a
  *performance* boundary means one config change moves two unrelated things.
- **`initial_load` uses the same column with one seed**: the view starts busy until the platform's
  own runtime-ready marker — `loadEventEnd` on web, `performance.rnStartupTiming` on native — then
  settles. Splitting the column by `load_type` was rejected: two metrics in one column discriminated
  only by a sibling key.
- **A request in flight across a view boundary belongs to the old view and does not hold the new one
  open.** Both `loading_time` and `view.request_count` count requests *started* in the view.

⚠ **Four things or the column gets misread:**

1. **A naive `AVG(loading_time)` mixes populations.** Read two series, per above.
2. **The clock starts at the route change, not at the tap.** Tap-to-route-change latency is
   **excluded** — that interval runs a handler in the *old* view, and charging it to the new one
   makes `Checkout`'s p75 move when someone slows a button on `Cart`. It belongs to the action
   envelope (§6.6). `view.loading_time` answers *"why was that screen slow"*; the envelope answers
   *"why did my tap feel slow"*; LCP (§5.3) answers *"when did it look ready"*.
3. **Native `initial_load` is systematically smaller than web's** — web includes DNS, TLS and
   document download; native is a bundle read from local disk with no network. **Cross-platform
   `initial_load` comparison is not apples-to-apples.** Within-platform release comparison is
   untouched.
4. **A prefetched screen reports `no_activity`.** Exact as "started no fetches of its own"; wrong if
   read as "does not fetch". The user's actual wait moved to the action envelope.

**Free invariant you can assert on arrival: `loading_time_outcome = 'no_activity'` ⇔
`view.request_count = 0`, on the same view.** A disagreement is a bug report about the SDK, not an
ambiguity in this contract.

### 4.6 `ui.interaction` ✱ — both builds, eight keys

Replaces `user.interaction`, which Android's own contract already tells you not to build a table for.
Storage is **already provisioned**: `rum_ui_interactions` exists with seven `ui_*` columns including
`ui_name_source`; the dispatch case is `ui.interaction` (`service.go:272`), which is exactly why RN's
`user.interaction` never fired it.

| Key | Type | Null? | Cardinality | Builds |
|---|---|---|---|---|
| `ui.type` | string | never | **2** — `click` (web) / `tap` (native) | both |
| `ui.target` | string | never | ~100s, **capped 64 chars** | both |
| `ui.name_source` | string | never | **6** web / **2** native | both |
| `ui.tag` | string | never | ~20 | both — resolved element's `tagName`, lowercased |
| `ui.x` | int, viewport px | never | high | both |
| `ui.y` | int, viewport px | never | high | both |
| `ui.dead` ✱ | bool | **omitted when not evaluated** | 2 | **web only** |
| `ui.rage` ✱ | bool | **omitted when false** | 1 (`true`) | both; native gated to `edge_action` |

**Naming: a five-rung ladder gated on element role.** A name is derived automatically **only** from
the nearest ancestor in `composedPath()` that is actionable *by role* — `<button>`, `<a href>`,
`<input type=submit|button|reset>`, `<summary>`, `<option>`, or
`[role=button|link|tab|checkbox|radio|switch|menuitem|option]`.

| # | Source | `ui.name_source` |
|---|---|---|
| 1 | `data-edge-action-name` — explicit, always wins, **works on role-less elements too** | `edge_action` |
| 2 | `data-testid` — **read, never written** | `test_id` |
| 3 | `aria-label` | `aria_label` |
| 4 | `title` | `title` |
| 5 | `textContent` | `text` |
| — | nothing survived | `none` |

Rungs 2–5 are normalized (trim, lowercase, non-alphanumeric → `_`, collapse runs, **cap 64**); rung 1
passes through unnormalized, because it is explicit author intent and a consumer must be able to
predict the value they just set.

**Why the Role gate is a proxy and not a heuristic, on RN-Web specifically:** `createDOMProps` maps
the `role` prop to an analogous semantic element and `accessibilityLabel` to `aria-label`, so a
`Pressable` **is** a labelled role-bearing element automatically, while the PII-carrying clickable
`<div>` sets no role and is never auto-named.

⚠ **The Role gate is a proxy, not a privacy guarantee.** `<button>Delete John Kamau</button>` still
ships that text. `beforeSend` is the answer, and there is deliberately **no second per-element
masking mechanism** — no `data-edge-mask`, no placeholder mode.

**Three unnamed values, not two.** Every click emits, including non-actionable ones (suppressing them
would destroy dead-click detection at the source):

| Click lands on | `ui.target` |
|---|---|
| role-bearing, a rung matched | the derived name |
| role-bearing, nothing survived | **`unnamed`** — actionable, someone should add `data-edge-action-name` |
| role-less, `cursor: pointer` | **`unnamed`** — same: an instrumentation gap |
| role-less, default cursor | **`surface`** — whitespace, nothing to fix |

Collapsing the last two into one recreates the original disease in miniature: `40% unnamed` with no
way to tell missing instrumentation from people tapping whitespace.

**Native cannot see what it touched.** `interactionProps()` sits on the consumer's **root** `<View>`
and `PressEvent.nativeEvent.target` is a node tag number with no public API resolving it. So native
ships explicit-only `trackTap(name)`, a two-value `ui.name_source` (`edge_action | none`), **no
`surface`** (the root responder cannot distinguish a tap on a button from a tap on padding, and
claiming the distinction would be a lie), and a **mint/emit split** forced by RN's root-before-child
capture order.

⚠ **The emitted `timestamp` is the mint time, never the emit time** — and with it `view.id`,
`view.name` and `session.id` are **snapshotted at mint**. Stamping the emit time would start the root
~300 ms *after* the request it parents, and for a click that navigates it would attribute the
interaction to **the view it opened, not the view it happened in**, silently inverting every "which
screen frustrates users" query.

**`ui.screen` is dropped on both builds — a deliberate, documented deviation from Android.** Android
carries it because Android has no view-in-context; RN puts `view.name` on the Context block of every
event, so `ui.screen` would ship the same string twice — and RN's copy would be the **worse** one,
since its only source is `telemetry.currentScreen`, which is **never written** for React Navigation
consumers. Dropping it *repairs* that defect for interactions for free.

**Frustration signals — two computed in the SDK, one defined for you.**

- **`ui.rage`**: ≥3 clicks within a 1000 ms sliding window **on the same live element node**.
  Identity is the DOM node reference, never `ui.target` — which is the whole reason it runs
  client-side, since three clicks on three different `unnamed` divs are indistinguishable on the
  wire. **One flag per burst**, on the crossing (3rd) click, so **rage bursts = count of flagged
  rows**. ⚠ **Absent means false**, deliberately asymmetric with `ui.dead`.
- **`ui.dead`**: no DOM mutation (attribute-only counts, so a CSS-class flip is alive), no request
  started, no navigation, within **1000 ms** — the same constant as §4.5.2, not a second one. Judged
  only on **actionable** clicks, minus text-entry and `download`/`_blank` anchors. ⚠ **Omitted when
  not evaluated**, and absence is load-bearing. It **under-reports by construction and never falsely
  accuses**: routine React re-rendering makes dead clicks read *alive*.
- **Error click spends no key at all.** It is the exact join: a `ui.interaction` whose
  `rum.action.id` appears on an `app.crash` or `app.error` row **where
  `trace.root_type = 'interaction'`**. ⚠ **The `root_type` filter is not optional** — without it the
  signal absorbs launch and route-change errors. Causality is exactly as strong as §6.3's 2 s / 10 s
  envelope rather than a fourth invented window, and sampling is safe because §3.6 samples whole
  sessions, so the join never half-lands.

⚠ **Two native traps:**

- **Dead click cannot exist on native** — no DOM, hence no mutation signal. **Any dead-click *rate*
  must filter `sdk.platform` to the web build**, or native interactions inflate the denominator and
  can never contribute to the numerator.
- **Native rage coverage equals native instrumentation coverage.** Rage ships on native but only for
  `ui.name_source = edge_action`, because running it over `unnamed` would not merely lose information
  — it would **invent a user-frustration event that never happened**. A low native rage count means
  *few named taps*, not *happy users*.

### 4.7 `app.crash` and `app.error` ✱ — the error surface

**Two names, not one.** `app.crash` = unhandled / fatal-ish. `app.error` ✱ = handled or non-fatal.

The reason is a query: **"crash-free session rate" is `COUNT(event_name='app.crash') / sessions` with
no `WHERE` clause** — the metric people actually dashboard, and the one that silently breaks whenever
someone forgets the filter. Android lives with `is_fatal:false, handled:true` on an event named
`app.crash`; RN spends one allowlist name to avoid that lie.

**There is no public path to `app.crash`.** Android's `recordCrash(Throwable)` lets a consumer
manufacture rows in the one table that must stay trustworthy for an unfiltered count. Not adopted —
and this is also why `eventName` is Tier A immutable in §3.6, since a writable one hands that path
straight back.

| Key | Type | Null discipline | Cardinality | Cap |
|---|---|---|---|---|
| `error.type` | string | never | ~100s | **255** |
| `error.source` | string | never | **5** | — |
| `error.message` | string | **omitted** when absent | high | **1000** |
| `error.stacktrace` | string | **omitted** when absent | very high | **2000**, tail-truncated |
| `error.fatal` | bool | **omitted on web** | 2 | — |
| `error.breadcrumbs` | string (JSON array, 20 entries) | never on `app.crash` | unique | — |

Retires all five `crash.*` keys. **Both explicit wire nulls are gone**, which makes the SDK's null
discipline universal.

**`error.type` is read from `error.name` only — never `constructor.name`.** RN production bundles
minify class names, so `class PaymentError extends Error {}` would report as `"a"` — not merely
unreadable but **unstable across builds**, refragmenting grouping on every deploy. `error.name` is a
string literal in the author's source and survives minification intact. Un-named custom classes
report `"Error"`: low cardinality but honest.

**`error.source` is a full re-cut of `crash.cause`, not a rename.** Only one value survives intact:

| v3 `crash.cause` | v4 `error.source` | v4 event |
|---|---|---|
| `Error` | `global_handler` | `app.crash` |
| `UnhandledRejection` | `unhandled_rejection` | `app.crash` |
| — | `cross_origin` ✱ **web only** | `app.crash` |
| `ConsoleError` | `console` | **`app.error`** — note the event changed |
| — | `reported` ✱ | `app.error` — from the new `captureError()` |
| `ConsoleWarn` | **deleted** | — becomes a breadcrumb only |

⚠ **Do not map old values onto new ones positionally.** `cross_origin` exists because `window.onerror`
receives `error === undefined` for scripts served from another origin without CORS headers — the
classic `"Script error."` with no stack, which RN-Web apps serving a CDN bundle hit constantly. Naming
the instrumentation gap beats collapsing it into mystery `Error`s.

**`error.handled` does not exist.** Android needs the boolean because all three of its error names are
unhandled-ish; RN spent an allowlist name to encode the same bit in the event name, and carrying both
is a denormalization that can *disagree*.

⚠ **`error.fatal` is native-only and omitted on web, and this is a trap.** On web nothing is fatal —
`window.onerror` fires and the page keeps running. A backend building
`crash-free rate = 1 − COUNT(fatal=true)/sessions` across all platforms scores **web at a perfect 100%
forever** — not because web is stable, but because the column is never true there. **Any
cross-platform crash-free chart must exclude web, or use the unfiltered
`COUNT(event_name='app.crash')`** that the two-name split above made safe.

**`error.breadcrumbs` stays a stringified JSON array, and rides `app.crash` only.** A real array would
**break on ingest**: `stringAttr` renders non-scalars through `fmt.Sprint`, producing **Go map syntax**,
not JSON. Android reached the same answer independently. It rides `app.crash` only because `app.error`
volume is consumer-controlled and a 1–2 KB blob on a high-volume event is how the transport budget gets
spent by the SDK's own doing.

**Truncation drops the tail, never the head**, marked inline as `\n… [truncated]` — no key, countable
with a `LIKE`, zero schema. The top frames *are* the grouping input. ⚠ **And truncation must land on a
frame boundary**: on Hermes the bytecode offset is the entire signal (line is a constant `1`), so a cut
mid-frame turns `at p (address at bundle:1:132161)` into `…bundle:1:13`, which resolves to a
**different, wrong** location rather than failing. 2000 may be tight for Hermes; it is a **tuning knob,
not a contractual constant**.

**Grouping is processor-side. There is no fingerprint on the wire, by decision.** The decider is
iteration speed: grouping algorithms always change, and processor-side that is a backfill while
SDK-side it is an app-store rollout across a population that never fully converges.

⚠ **The message must be normalized by you.** Android's `CrashFingerprinter` — which has never shipped
a byte, being referenced only by its own definition — hashes the **raw** message, so
`"User 12345 not found"` and `"User 67890 not found"` are different issues: **one row per user**, the
most common way error grouping fails. **The ingest grouping key is `error.type` + normalized message,
frames excluded.** It **over-groups by design**, which is the recoverable direction: a later pass with
resolved frames can split, but history can never be re-merged.

**Public API delta: one method** — `captureError(error: unknown, context?)`. It must accept `unknown`,
because half of real `catch` blocks receive a string or an axios rejection object.

⚠ **"% of errors attributed to an action" is bounded well below 100% by design.** `app.error` from
`captureError` is annotated with whatever root is live at call time; a consumer calling it from a
background retry — no tap, no navigation — gets no trace keys at all. Correct behaviour, not a gap.

⚠ **Route these to `rum_crash_events`, not `rum_errors`** — work-list 4. And note the v3 defect that
made this invisible: `extractError` reads **undotted** keys, so every RN crash today writes a
`rum_errors` row with all fifteen payload columns empty.

#### 4.7.1 A fatal crash is not reliably delivered, and web and native differ

In v3 `log()` pushes to an in-memory array and flushes only at `batchSize`; the offline store persists
only *failed* sends. So the native fatal path is: handler fires → event lands in the queue → the
handler calls the previous default handler, which **tears the app down** → the process dies with the
event in memory. **Delivery is biased toward the crashes that didn't matter** — soft errors in busy
sessions arrive, fatal ones in quiet sessions vanish — which reads as *healthy*.

v4 gives `app.crash` a dedicated path: **persist the whole queue, then send one batch reordered so the
crash rides in it.** The whole queue, because the events behind it are what explain it; one batch, not
a drain, because a dying process gets one round trip if it is lucky.

⚠ **The asymmetry is real and is not fixed in v4.** On **web this closes the window** —
`localStorage` is synchronous, the write completes inside the error handler. On **native it only
narrows it** — `AsyncStorage` is async and a fatal JS error tears the bridge down mid-write. The
honest fix is a synchronous native store, which needs the SDK's first native module (§10.3).
**Native fatal-crash delivery is best-effort and under-reports by an amount the SDK cannot count**,
because `sdk.events_dropped` needs a live process.

### 4.8 Symbolication — what `app.build_id` joins to

Symbolication is greenfield on your side: `build_id|symbolic|sourcemap|proguard|deobfusc` returns
**zero hits** across both backend repositories.

**The resolve key is `(app_id, device.platform, app.build_id)` — three parts, not one.**
`app.build_id` is a string the *consumer* chooses, and the obvious choice is a git SHA or CI run
number, which is **identical for the iOS and Android builds of the same commit**. Metro's output
differs between platforms, so a single-part key resolves an Android crash against the iOS map and
produces frames that are **plausible and wrong**. `device.platform` is already on Context, so the
second part is free.

⚠ **No fallback to `app.version` + `app.build_number`, ever.** It is correct for the majority — which
is exactly what makes it dangerous. Under Expo Updates or CodePush the native binary is unchanged, so
the fallback fetches the **wrong** map and resolves to plausible-wrong lines with nothing on the row
marking it untrustworthy. **Absence of `app.build_id` is itself the signal**, and it is **omitted when
unset, never `""`** — an empty-string build_id would reproduce §9.3's `rum_apps` collapse inside
symbolication.

**Grouping runs at ingest, before and independent of symbolication.** `crash_hash` is `NOT NULL` and
the processor inserts one row per event in its own transaction, so the hash must be computable from
wire data alone; grouping-after-symbolication would block an insert on an artifact that may arrive
hours later or never. And the advantage of waiting does not exist anyway: with mangled names, `line`
a constant `1`, and the column a **bytecode offset** the RN docs say *"even minor code changes can
significantly alter"*, there is **no build-stable frame signal on the raw wire**.

**`error.stacktrace` travels raw and byte-for-byte** — no normalization, no reformatting, no path
rewriting. `metro-symbolicate` consumes the engine's native format, and any normalization breaks it.
Structured `error.frames` was rejected: the SDK would parse **three** formats (V8 `at fn (url:1:2)`,
JSC `fn@url:1:2`, Hermes `at fn (address at bundle:1:2)`) and every parser bug becomes an app-store
rollout.

**Four columns on `rum_crash_events`, split by who fills them** — a labelled table, so nobody sizes a
backend column as SDK surface:

| Column | Filled by | Note |
|---|---|---|
| `app.build_id` | **SDK** | **must be promoted out of the bag** — a join key in a bag nothing queries is inert |
| `crash_hash` | **backend** | already exists, `NOT NULL`, **no producer by design** |
| symbolicated stack (nullable) | **backend** | a cache of the resolve pass. Do not overwrite `stack_trace` — that destroys the raw and makes re-symbolication with a corrected map impossible |
| refined group (nullable) | **backend** | the post-symbolication key, kept separate so `crash_hash` never moves under a dashboard |

**Two consumer wiring steps, with their costs** — the document names exactly two:

1. **Set `app.build_id`.** Skip it and crashes are unsymbolicatable. The SDK has **zero** OTA
   awareness (no `expo-updates` or `code-push` dependency, peer or optional), so it cannot derive one.
2. **Raise `Error.stackTraceLimit`.** RN 0.81.4 sets it nowhere, so **V8's default of 10 frames**
   governs — not the 2000-char cap, which holds ~26. Skip it and web stacks are 10 frames deep, which
   for an error surfacing through `unhandledrejection` can be entirely library internals. The SDK does
   **not** raise it globally: that is an invisible mutation of the consumer's runtime, making every
   `new Error()` in their app more expensive and unattributable to us.

`app.build_id` is `app.*` and therefore **already Tier A immutable** — the join key cannot be scrubbed
away. `error.stacktrace` is **Tier C and stays there**: a consumer with genuine PII in frames must be
able to drop it, and that forfeit is theirs to make.

### 4.9 The undotted ↔ dotted mapping table

RN moves its error payload to a dotted `error.*` namespace. This is **one of five deliberate
departures from "borrow Android"** (§13) and it is argued, not slipped in: RN's `attributes` is one
flat namespace shared with 124 other keys, and `log()` flattens caller `data` straight into it, so a
consumer calling `log("checkout_failed", { message: "…" })` would collide with the crash vocabulary.
`message` and `cause` are precisely the two words most likely to arrive from userland.

Its price is this table, which RN ships so nobody derives it by hand. If `rum_crash_events` is one
table across SDKs, its extractor reads **two literals per column**:

| Column (`rum_crash_events`) | Android sends | RN v4 sends | RN v3 sent |
|---|---|---|---|
| `error_message` | `message` | **`error.message`** | `crash.message` |
| `stack_trace` | `stacktrace` | **`error.stacktrace`** | `crash.stacktrace` |
| `exception_type` | `exception_type` | **`error.type`** | *(nothing — the largest hole in v3)* |
| `cause` | `cause` | **`error.source`** | `crash.cause` (different domain — see §4.7) |
| `is_fatal` | `is_fatal` | **`error.fatal`** | `crash.fatal` |
| `breadcrumbs` | `breadcrumbs` | **`error.breadcrumbs`** | `crash.breadcrumbs` |
| `error_context` / `product_id` / `error_code` / `user_action` / `severity_level` | Android only | **never sent** — §10.1 | never |
| `crash_thread` / `crash_is_main_thread` | Android only | **never sent** | never |
| `crash_hash` | — | **never sent** — backend-computed | never |

`extract.go` already promotes by explicit key literal, so this is a second line in a switch, not an
architecture change.

### 4.10 `user.profile.update` — answering your open question

⚠ **This section answers processor follow-up #2 rather than making a request.** Its "Do" step reads:
*"Confirm the exact wire keys the SDK uses for the profile fields first."* Here they are.

| Key | Destination | Cap |
|---|---|---|
| `user.name` | `rum_users.name` | 255 |
| `user.email` | `rum_users.email` | 255 |
| `user.phone` | `rum_users.phone` | **50** |
| `user.custom.*` | `rum_users.profile_data` or the bag | ≤ **64 keys**, key ≤64 chars, value ≤255 |
| `user.custom_dropped` ✱ | int, overflow counter | — |

Plus `user.id` from the Context block, which is **always present on this event by construction**:
`identify()` gains an optional `userId` in v4, so the one call that emits a profile also sets the key
it must be attached to. (In v3 `identify()` never set `userId` at all, which under §3.2's
consumer-supplied `user.id` would have produced an unkeyable profile against a `NOT NULL UNIQUE`
column.)

**This is not a cosmetic surface.** `rum_users.name` / `.email` / `.phone` are read across **six**
analytics repositories — including two `ILIKE` search paths and an `idx_rum_users_name_trgm` GIN
index — and **all three are NULL in production today**, for want of a dispatch case. Six user-facing
product surfaces are dark.

**`user.custom.*` domain: non-primitive value → `JSON.stringify`, then truncate.** One rule retiring
three v3 defects at once — `flattenWithPrefix` (`telemetry.ts:601-618`) has **no depth guard**, so a
cyclic `customAttributes` value recurses to a `RangeError` **inside `collect()`** (the SDK crashes the
host app on a bad `identify()`); arrays pass through raw, violating the primitive-values rule; and
nested objects recurse into the bag. Overflow past the caps is dropped, counted, and warned once under
`__DEV__` — **never a throw**.

**Consumer-supplied keys under `user.custom.*` pass through verbatim**, including their casing. This
is the one slice of the bag where arbitrary spelling is expected; the SDK imposes no normalization
there and you should not size one.

### 4.11 The deprecated native feeds — `navigation` and `screen.duration`

Both keep emitting on native, unchanged, for v3 consumers and Android parity. **Web emits neither**
and never has (§4.0). Both are **removed in v5**.

`navigation`: `navigation.from_screen` (⚠ the SDK's only explicit wire `null`, on the first
`screenStart`; the route-change path substitutes the string `"init"` — accept both), `.to_screen`,
`.method` (2 values), `.route_type` (const `"screen"`).
`screen.duration`: `screen.name`, `.duration_ms`, `.exit_method` (const `"navigation"`).

⚠ **Their v4 volume goes *up*, not down, and you must not size those tables from v3 traffic.** In v3
the two native screen paths are **disjoint**: `attachNavigation` — the zero-instrumentation path the
SDK advertises — registers a listener that calls `NavigationTracker.recordRouteChange`
(`navigationTracker.ts:12`) and **never touches `inst.screens`**, while `ScreenTimingTracker` is
armed only by the public `screenStart()`. So a React Navigation consumer emits `navigation` on every
route change and **never a single `screen.duration`**. v4 unifies both paths onto one `ViewManager`,
which fixes that as a side effect — so **`screen.duration` starts firing where it never has, at the
same moment it is declared deprecated.**

⚠ **Target-table ambiguity you must resolve.** `navigation` has two candidate tables and the
processor writes the wrong one: `rum_navigations` (processor-owned, **25 rows, 0 analytics readers**)
against `rum_navigation_events` (analytics-owned, **583,907 rows**, read 3×). All four landing
`navigation.*` keys are currently invisible. This is your follow-up #3, and it is a hard dependency
for RN navigation visibility: fixing RN's key names alone would move data into a table with no reader.

---

## 5. Metrics, key by key

Metrics carry the identical §3 Context block. They do **not** extend the breadcrumb trail and do
**not** count as session activity, so a sampler cannot keep a session alive past the idle rotation.
**All metrics are trace-free** — §6.3.

**`metric.unit` is set in v4, and the SDK has never sent it at all.** `rum_performance_metrics.unit`
has been NULL for every RN row ever landed. Values: `ms` for `frame_render_time`, `LCP`, `FCP`, `INP`,
`TTFB`; `MB` for `memory_usage`; **`score` for `CLS`** — without which every chart that does not
special-case `metric_name` renders a CLS of `0.08` as a flat zero line beside an LCP of `4000` in the
same `value` column.

### 5.1 `frame_render_time` — both builds

`value` = p95 frame time in ms.

| Key | Type | Cardinality | Note |
|---|---|---|---|
| `frame.max_ms` | float | unbounded | |
| `frame.p95_ms` | float | unbounded | **duplicates `value`** |
| `frame.dropped_count` | int | small | ⚠ values move in v4 — below |
| `frame.target_fps` ✱ | int | **{60, 90, 120}** | renamed from `frame.target_hz`, and now **measured** |
| `frame.source` | string | **1** — const `"requestAnimationFrame"` | |
| `frame.window_duration_ms` ✱ | int ms | measure | required by the reset below |

⚠ **`frame.target_hz` was hardcoded `60`, never read from the display** — so it is wrong on every
90 Hz / 120 Hz device, **and so is `frame.dropped_count`**, which budgets against the same constant.
v4 measures the refresh rate from the rAF deltas already aggregated (their floor *is* the refresh
interval — no new platform API). **`frame.dropped_count`'s values move on high-refresh devices.** This
is a correction of a wrong number, not a break, but it is a chart discontinuity.

The rename adopts a column name that is **already built** (`rum_performance_events.frame_target_fps`),
which asks nobody else to move — *report, don't propose* bars RN from inventing a canonical frame
model, not from spelling one key the way the schema already spells it. Stated plainly: **the rename
wins nothing at ingest today**, because that column is on the *event* path
(`extract.go:220-224`, gated on `frame.summary`/`memory_pressure`) while RN's metric goes down the
*metric* path. The measurement fix is the part that pays.

**The window resets at every view boundary** ✱. A fixed 10 s window straddling a route change charges
the departing screen's frames to the **arriving** one — backwards for the one query the metric exists
to serve, and route transitions are exactly when frames drop. That makes windows variable-length,
which is why `frame.window_duration_ms` is required: a p95 over an unknown sample count is
uncomparable. Accepted cost: a fast route change emits a p95 over a thin sample.

### 5.2 `memory_usage` — **native only in v4**

`value` = used memory in MB. Five attributes become three.

| Key | v3 | v4 |
|---|---|---|
| `memory.type` | const `"heap"` | **`"rss"`** ⚠ |
| `memory.source` | `Platform.OS` native / const `"performance.memory"` web | `Platform.OS` — the web value is gone with web |
| `memory.total_mb` | — | ✱ added |
| `memory.usage_mb` | float | **dropped** — duplicates `value` |
| `memory.pressure_level` | 3 values | **dropped** — and it has been **discarded on arrival for every RN sample ever sent** (§10.4) |
| `memory.unit` | const `"MB"` | **dropped** — `metric.unit` supersedes it |

**Source moves to `DeviceInfo.getUsedMemory()`** — RSS, engine-independent, architecture-independent,
already installed. `performance.memory` sees the **JS heap only**, and RN's memory lives largely in
native allocations (images, native views) which are what actually get the process OOM-killed.

⚠ **`memory.type` goes `"heap"` → `"rss"` on a promoted column, and there is real v3 data behind it.**
RN 0.81.4 *does* implement `performance.memory` on Hermes, so the metric fires on New-Architecture +
Hermes builds. A chart spanning the cutover silently compares two different quantities.

⚠ **Web drops `memory_usage` entirely.** `performance.memory` is Chromium-only, so the metric's
*presence* is a browser-detection signal wearing a memory label, and a p95 over Chrome-only users is
biased data carrying an undeclared population label.

v4 also **calls `start()`**: in v3 `trackMemoryUsage()` calls `recordMemoryUsage()` once and the
periodic `start(30000)` loops have no caller — and the one call it does make then throws, because
`.catch` is applied to a `void` return. The metric is effectively single-shot, and often zero-shot.

### 5.3 Web Vitals ✱ — **web only, five metric names, 14 attribution keys**

They ride the **metric path**, not the event path, and the decider was not taxonomy: an event named
`LCP` would land its name in `rum_performance_events` and **lose its number**, because
`extractPerformanceEvent` promotes only memory and frame columns. The metric path promotes `value`
and `unit` for free, indexed by `metric_name`. **All five names are already on the allowlist.**

Source is **`web-vitals/attribution`**, a bundled web-only `dependency` — `vite.config.ts:38-43`
externalizes an explicit allowlist, so native ships zero extra bytes and consumers install nothing.
Hand-rolling was rejected on session-windowed CLS (the naive sum is wrong *and plausible*) and
percentile INP.

**Four shared keys, on every vital row:**

| Key | Null? | Domain |
|---|---|---|
| `vital.target` | **yes** | unbounded — LCP `target` / CLS `largestShiftTarget` / INP `interactionTarget`; null on FCP + TTFB |
| `vital.rating` | never | **3** — `good`\|`needs-improvement`\|`poor` |
| `vital.navigation_type` | never | **6** — `navigate`\|`reload`\|`back-forward`\|`back-forward-cache`\|`prerender`\|`restore` |
| `vital.load_state` | **yes** | 4 — null on LCP + TTFB |

⚠ **`vital.navigation_type` is load-bearing, not decoration.** A `back-forward-cache` LCP is ~0 ms and
will silently drag a p75 down.

**Ten per-vital keys:** LCP — `lcp.time_to_first_byte`, `lcp.resource_load_delay`,
`lcp.resource_load_duration`, `lcp.element_render_delay`, `lcp.url` (query-stripped). INP —
`inp.input_delay`, `inp.processing_duration`, `inp.presentation_delay`, `inp.interaction_type`
(2 values). CLS — `cls.largest_shift_value`. TTFB and FCP carry none.

LCP's four phases **sum exactly to `value`**, so the row is self-checking —
`lcp.time_to_first_byte` deliberately duplicates the `TTFB` row rather than forcing a cross-row join
to decompose one number.

**`vital.target` is a raw CSS selector, bag-only, never promoted.** §4.6's action-name ladder was
rejected for it: the Role gate blanks `<img>`, `<h1>` and banners, which is most vital targets, and
un-gating the ladder would rebuild the `textContent` hole the gate closes. A selector is
developer-authored structure — tags, ids, classes — never user content, so it clears the privacy bar
with no new mechanism. It is also the **least sanitized key on the wire**, which is why `beforeSend`
covers metrics.

⚠ **Three things about scope:**

1. **Vitals are page-load-scoped, not view-scoped.** `LCP`, `FCP` and `TTFB` physically **cannot
   recur on a soft navigation** — they fire once, on the initial load. Any panel grouping them by a
   non-entry `view.name` returns empty. View-scoping would need the Chrome-only Soft Navigations API,
   or a per-view INP reset that produces "slowest interaction in this view" wearing INP's name.
2. **`view.id` on a vital row is always the *initial* view's.** It is a real join key; it is just not
   "the view this happened in" for CLS and INP. `GROUP BY view.name` over vitals reads **"by entry
   point"** — a genuinely useful dashboard, but only if you name it that way.
3. **All five are web-only.** `TelemetryNative` emits none, ever. Native's load-performance analogue
   is `app.start` (§4.3).

CLS and INP subscribe with `reportAllChanges: true` as a **running-value subscription, not an
emission trigger** — the latest value is held in memory and emitted at the ViewManager's background
boundary. The library's default page-hide report would lose both on every closed tab.

---

## 6. Trace and span

RN adopts Android's model. Every trace key is new to RN — `trace`, `span` and `traceparent` appear
nowhere in v3 `src/`. **Allowlist delta: zero** — every trace key rides an event that already exists.

### 6.1 The keys

| Attribute | On | Notes |
|---|---|---|
| `trace.id` | Tier 1 + Tier 2 | 32 lowercase hex, W3C |
| `span.id` | Tier 1 only | 16 lowercase hex; on `adopted`, mirrors the foreign parent-id |
| `parent.span.id` | children only | omitted on roots, on `adopted`, on unattributed, on expired |
| `rum.action.id` | Tier 1 + Tier 2 | the root's `span.id` — the stable join key |
| `trace.root_type` | Tier 1 + Tier 2 | `launch`\|`interaction`\|`navigation`\|`request`, **denormalized onto every child** |
| `span.start_time` | Tier 1 only | ISO 8601, matching the SDK's existing timestamp discipline |
| `span.duration_ms` | Tier 1 **children only**, **never `view`** | roots derive server-side at query time |
| `traceparent.outcome` | `http.request` only | **7 values**; **absent = not traced** |

**`rum.action.id` identity is adopted exactly as Android holds it**: `== span.id` on a root,
`== parent.span.id` on a child. That identity is the single thing making the envelope one `GROUP BY`
instead of a self-join.

All seven columns **already exist** on `rum_telemetry_events` (`trace_id`, `span_id`,
`parent_span_id`, `rum_action_id`, `trace_root_type`, `span_start_time`, `span_duration_ms`), plus the
`rum_action_envelopes` view. Trace ids are populated on 112 of 1,390,117 `rum_http_requests` rows —
the Android 2.2.2 traffic — and `rum_trace_spans` and `rum_user_actions` both have **0 rows**.

### 6.2 What mints a root

| Event | Mints when | `trace.root_type` |
|---|---|---|
| `app.start` | once per process | `launch` |
| `ui.interaction` | every tap/click | `interaction` |
| `view` | no root is live | `navigation` |
| `http.request` | no root is live | `request` |

**`trace.root_type = navigation` means the same thing on both platforms** — *a route change no action
explains*. What differs is the **input**, and that asymmetry belongs here rather than being discovered
in a dashboard:

| Input | Root type | Why |
|---|---|---|
| web back/forward button | `navigation` | browser chrome fires no `click` on `document`. **The dominant source of `navigation` roots on web.** |
| native hardware back / `BackHandler` | `navigation` | produces no responder event |
| native **swipe-back gesture** | `interaction` (named `unnamed`) | a swipe starts with a touch, so the responder fires and mints |

Two rulings inside this: **web's hard page load is `launch`, never `navigation`** — only History-API
soft navigations mint `navigation`, or every reload double-counts. And **background clears the live
root** on both builds, so a resumed app's first fetch mints its own root rather than joining an action
from before the user left.

`span.start_time` for the launch root is asymmetric, and **neither value is a fork time**: web uses
`performance.timeOrigin` (true navigation start — *better* than Android's), native uses SDK
`initialize()` (everything before the JS bundle loads is invisible; JS cannot see process fork).
**Do not compare native and web launch envelopes as if they measured the same interval.**

### 6.3 Three tiers of participation

**Tier 1 — span-carrying:** `app.start`, `ui.interaction`, `view`, `http.request`.

⚠ **`view` carries `span.start_time` but never `span.duration_ms`, not even as a child.** View dwell
is not span duration. With a duration, the envelope aggregate
`MAX(child.start + child.duration) − root.start` would stretch every tap-that-navigates envelope
across **the entire time the user sat on the screen**, so every such tap would report a multi-minute
action. Omitting it makes `view` a **point span**: it marks where the trace went without claiming a
width, and `NULL` drops out of the `MAX`.

⚠ **A `view` row parents to the root live at view *entry*** — the action that opened the screen, not
the one that closed it. Ordering is then correct by construction (the root that opened a view was
minted before the view existed), a tap's envelope contains **the screen it opened**, and a launch
envelope contains the landing screen. This is a **deliberate amendment to the model's first draft**,
recorded so the next person diffing RN against Android does not file it as drift.

⚠ **`view`'s wire `timestamp` is the exit time; its `span.start_time` is the entry time**, and **a
navigation root's row arrives *after* its own children.** Fetches during a view ship in earlier
batches than the `view` event closing it. Do not assume root-before-child arrival — on RN it is the
**normal** case, not the offline one.

**Tier 2 — annotation-only:** carries `trace.id`, `rum.action.id`, `trace.root_type`. No `span.id`, no
parent, no duration — it joins a trace without occupying a span. `app.crash`, `app.error`, and
`custom_event`. ⚠ `custom_event`'s inclusion is **the one place RN goes past Android**, flagged as an
invention rather than borrowed precedent: a consumer's `log("checkout_started")` from a tap handler
joining that tap's trace is how a business funnel gets attributed to a user action.

**Tier 3 — trace-free, stated so nobody asks later:** **all metrics** (`frame_render_time`,
`memory_usage`, all five vitals), plus `app_lifecycle`, `network_change`, `session.started`,
`session.finalized`, `user.profile.update`, and the deprecated `navigation` / `screen.duration` feeds.

⚠ **The metrics exclusion is the one worth arguing, so here it is argued.** A windowed aggregate
belongs to no single action: `frame_render_time` is a p95 over a window, and vitals are
page-load-scoped. Stamping a `rum.action.id` on either would invite `GROUP BY rum_action_id` over a
number that was never attributable — **and the join would look valid.**

### 6.4 Injection — the allowlist *is* the CORS mitigation

**One knob: `traceHostAllowlist: string[]` on `TelemetryOpts`, constructor-only, both builds, bare
hosts, exact match, empty by default.** v4 is dark on upgrade: nobody's CORS breaks until they opt in.

> **Listing a host is the consumer's assertion that that host's CORS config allows the header.**

That sentence is the contract of the knob, and it is why regexes and predicate functions were
rejected rather than deferred — you cannot make that assertion over a pattern, and this document
could not state which hosts receive a header if the answer were `(url) => boolean`. **No same-origin
exemption**, or injection would depend on where the app happens to be deployed.

**`traceparent` only. No `b3`, no `tracestate`, in either direction.** Every additional header is
another line the customer's server team must add to `Access-Control-Allow-Headers`, and a *partial*
CORS config is worse than none — the preflight fails and the whole request dies, so a `b3` nobody
asked for would take `traceparent` down with it. **The SDK writes exactly one header name, ever.**

**What the server team must do:** add `Access-Control-Allow-Headers: traceparent` on every
allowlisted host, and set `Access-Control-Max-Age`. ⚠ **Adding the header converts previously-*simple*
cross-origin GETs into preflighted ones, doubling round-trips on exactly the poor networks this SDK's
market runs on.** ⚠ **The failure signature to hand a customer:** *"our app broke after we enabled
tracing"* means `Access-Control-Allow-Headers` is missing on that host, not that the SDK is broken.

**The SDK does nothing else at runtime, and two candidates are declined on the record.**
Retry-without-the-header fires on real network failures too — a rejected preflight and a dead server
are the same `TypeError` — and would **double-send a non-idempotent POST**; a tracing feature must not
be able to double-charge a card. A preflight probe at init is scoped to URL + method, so `OPTIONS /`
proves nothing about `/api/payments`.

**Two invariants:**

- **Never-strip** — the SDK never removes or rewrites a header it did not add. Ownership is a
  **per-request flag set at write time, never inferred from the value's shape**: an SDK-minted and a
  consumer-minted `traceparent` are byte-identical by construction. Header names are compared
  case-insensitively.
- **Read-scope** — the SDK reads **exactly one header name, for exactly one purpose (a presence
  check)**, and never inspects, logs or forwards any other header.

**Matching is on `hostname` — ports ignored** — exact-only, no wildcards, punycode-normalized. ⚠ This
is a **deliberate mismatch with `http.host`**, which keeps the port. Do not join them. Malformed
entries throw in `__DEV__` and drop-and-`debug()` in production: a RUM SDK crashing a shipped banking
app over a config typo is the one failure worse than no tracing. **Stated divergence from Android's
unconditional `require`.**

An SDK-owned `traceparent` on a request the consumer's client **retries** is **replaced with a fresh
`span.id`** — each attempt is its own `http.request`, so each attempt is its own span.

### 6.5 The outcome ladder — and the question in §0.3

Seven values: **six core plus one web extension.** Precedence is table order.

| # | Value | Scope |
|---|---|---|
| 1 | `skipped_off_allowlist` | core |
| 2 | `skipped_no_cors` | **web only** |
| 3 | `skipped_consumer_set` | core — consumer header present and **unparseable** |
| 4 | `adopted` | core — consumer header present and **valid** |
| 5 | `injected_attributed` | core |
| 6 | `injected_expired` | core |
| 7 | `injected_unattributed` | core |

**Absence means not traced.** The SDK's own collector POST carries no outcome attribute at all.
**Every skip still stamps local ids with no wire header**, which is what makes *"missing DB join ⇒
header stripped in transit"* computable.

`injected_unwired` is **dropped** relative to Android, deliberately: it exists there because
`instrument(client)` is a wiring step a consumer can get wrong, and both RN builds patch the transport
in the constructor — **there is no wiring step**. Shipping a permanently-zero bucket means someone
eventually reads a zero that means *impossible* as one that means *healthy*.

`skipped_no_cors` is **fetch-only**, which is a sharper statement than "web-only": `mode` is a fetch
concept XHR cannot express, and native has no fetch patch (§4.4), so the shared XHR module needs no
platform branch to suppress it.

`skipped_consumer_set` is scoped to the **malformed** case only, using **Android's parse predicate
verbatim** (`TraceManager.kt:158-171`) so the two SDKs cannot classify the same header differently.
⚠ **Its price, said out loud:** on Android a malformed consumer header is *repaired* and the request
becomes traceable; on RN never-strip forbids that, so it goes out broken and is unattributed on
**both** ends — visible in the outcome distribution rather than silently fixed.

`skipped_no_cors` outranks it because on a `no-cors` request the headers guard drops the **consumer's**
`traceparent` too, so mirroring its ids would **manufacture a false correlation** against a header no
server ever saw.

#### The live enum does not match, three ways

`rum_http_requests.trace_injection` is `public.trace_injection_outcome`, with six labels defined in
**neither repository**:

```
injected_attributed
injected_unattributed_no_action
injected_unattributed_context_lost
injected_inbound_malformed
adopted
skipped_off_allowlist
```

Three of seven overlap. **Our ask (`VARCHAR`, retire the enum) is a widening, a re-partition and a
semantic conflict at once** — and the three cost you different things:

1. **Widening.** Four ladder values have no live label (`skipped_no_cors`, `skipped_consumer_set`,
   `injected_expired`, `injected_unattributed`). Keeping the enum means four `ALTER TYPE … ADD VALUE`
   calls on a ladder that grew from five to seven inside one planning effort — **and grew by a
   platform-scoped value**. A type whose membership depends on which SDK build wrote the row is a type
   doing a column's job. That is the argument for text.
2. **Re-partition — and we should adopt yours.** Live splits `injected_unattributed` by *cause*
   (`no_action` vs `context_lost`); the ladder collapses it. **Your split is strictly more
   informative and RN can distinguish both cases.** We propose adopting
   `injected_unattributed_no_action` and `injected_unattributed_context_lost` in place of the single
   value, rather than flattening yours away.
3. ⚠ **Semantic conflict — this is §0.3.** Live `injected_inbound_malformed` says *inject over a
   malformed inbound header*. §6.4's never-strip rules the opposite: `skipped_consumer_set` is a
   **skip**, because overwriting a consumer's bad header is forbidden. **Same situation, opposite
   verb.** RN's position is the skip, and it is argued above — but the enum encodes yours, and we
   need your call before this column is authored. **Population is 0 of 1,390,117 rows**, so whichever
   way it goes there is nothing to migrate.

**`trace_adopted bool` is deprecated as derivable** (`outcome = 'adopted'`). A bool and a
seven-value enum that both encode "adopted" will disagree the first time one is written and the other
is not.

Cost of text, stated: you give up the database's guarantee that a typo never lands, and RN is the only
writer disciplined by the closed domain above. Mitigation is this table plus an optional `CHECK` —
cheaper to migrate than `ALTER TYPE`, and unlike an enum it can be dropped.

### 6.6 Composition — two sibling groupings, and the third relationship does not exist

```
session
├── view    — strict child. Never spans a session.
└── action  — strict child. Never spans a session.
     └── MAY straddle a view boundary
```

**Invariants you can assert on:**

1. `view.id` never spans a `session.id`.
2. `trace.id` never spans a `session.id`.
3. **`rum.action.id` MAY span a `view.id`. There is no third invariant** — and this contract states
   its absence rather than letting you infer a hierarchy from the other two.
4. `loading_time_outcome = 'no_activity'` ⇔ `view.request_count = 0`.
5. Every event carries a non-null `view.id`.

An action genuinely outlives its view: a tap in A mints a root, the route change to B *extends* it,
and B's mount fetch is a child of an A-minted root. One `rum.action.id`, two `view.id`s, every row
correct. Forcing the hierarchy by ending the root at view start was rejected — it would split every
tap-driven flow at the exact seam you most want joined.

**The envelope survives as a query-time aggregate, never processor state**, and reports the **root's**
view by derivation, spending no key:

```sql
SELECT rum_action_id,
       MAX(view_id)   FILTER (WHERE span_id = rum_action_id) AS view_id,
       MAX(view_name) FILTER (WHERE span_id = rum_action_id) AS view_name,
       MAX(span_start_time + span_duration_ms)
         - MAX(span_start_time) FILTER (WHERE span_id = rum_action_id) AS envelope_ms
FROM rum_telemetry_events GROUP BY rum_action_id;
```

⚠ **A childless root has NULL duration, and an envelope is never final** — it widens when a late batch
lands, so a caching dashboard needs a recompute window rather than treating first-seen as complete.
RN's offline store replays arbitrarily late, which is *why* the envelope must stay derived.

Denormalizing the root's view onto every span was rejected on the ground that **zero `view.*` keys
reach any column today**, so there is no index to seek into and no measured query to optimize. The
upgrade path is real and cheap: denormalization is additive, a backfill rather than a migration.

### 6.7 Two pieces of Android machinery that do not transfer

Named, or their absence reads as an omission:

- **The `Call.Factory` request tag collapses entirely.** It exists on Android because OkHttp runs
  interceptors on a dispatcher pool thread, so a `ThreadLocal` carrier reads null for every
  `suspend`/`enqueue` call. Both RN builds patch a single-threaded JS transport, so a module-level
  carrier read synchronously inside the patch is correct **by construction** — there is no thread to
  lose it on.
- **The process-global `lastRoot` is unnecessary.** Android built it because its ANR watchdog and
  background-thread crashes cannot reach a `ThreadLocal`. JS is single-threaded: the crash and
  unhandled-rejection handlers read the live carrier directly. Android's standing warning about
  reading `lastRoot` from a parenting path has **no RN referent** and must not be copied into RN's
  spec, or RN inherits a guard against a hazard it does not have.

**Expiry: 2 s idle / 10 s cap, Android's numbers unchanged**, as internal constants and not
`TelemetryOpts` surface. The one real case for raising the cap is chained requests on poor networks —
three hops at 3 s each is 9 s against the ceiling — and it was rejected on Android's own logic:
`injected_expired` exists precisely so the numbers are falsifiable. Ship Android's, watch the expired
ratio, tune on evidence. A view's *start* extends the root; its *exit* does not. The clock is
`Date.now()`, with a negative delta clamped to *expired*.

**Sampling is session-level only, and never acquires a per-trace sibling.** A per-trace sampler
produces **orphan children** whose root was sampled away, so the envelope aggregate computes over a
root row that does not exist and silently under-reports. **An unsampled session injects no header at
all** — not a `flags=00` id, which would be a dangling reference in your logs that looks joinable and
is not.

---

## 7. The four-SDK vocabulary split — reported, not proposed

Four places where RN, Android, iOS and Flutter disagree about a name or a value domain in a column
they **share**. This section proposes nothing and asks no other SDK owner to change. It exists so you
do not build a chart on the assumption that one column means one thing.

### 7.1 `frame.*` — seven columns, zero overlap, and one quantity under two names

| RN sends (`frameAggregate.ts:8-11`) | The schema promotes |
|---|---|
| `frame.p95_ms` | `frame.build_duration_ms` |
| `frame.max_ms` | `frame.raster_duration_ms` |
| `frame.dropped_count` | `frame.type` |
| `frame.target_hz` → `frame.target_fps` in v4 | `frame.dropped` |
| `frame.source` | `frame.total_duration_ms` |
| | `frame.severity` |
| | `frame.target_fps` |

**Not one name coincides.** Seven `frame_*` columns exist across `rum_performance_metrics` and
`rum_performance_events`; RN's five keys hit **zero** of them. `frame.target_hz` vs `frame.target_fps`
is the same physical quantity one column apart — which v4 fixes by **adopting the existing column
name**, since that asks nobody to move.

The remaining four are a genuine model difference, not a spelling one: Android's frame model is
build/raster phases with a severity classification; RN's is a sampled percentile over rAF deltas.
**RN is not proposing a canonical cross-SDK frame model, and the ask is only that the bag catch RN's
spellings.** ⚠ **Do not wait for a rename.**

Worth recording alongside it: **RN and iOS already independently agree on the sampled-percentile
shape.** That is an observation, not a proposal.

### 7.2 The three name-level splits

| Concept | Android | iOS | RN v4 | Note |
|---|---|---|---|---|
| Session rotation cause | **`session.reason`** | `session.rotation` | **`session.reason`** — Android's key, iOS's placement | RN picks one and disagrees with the other either way |
| `sdk.platform`'s meaning | `"android"` — an **OS** | — | **`react-native-{Platform.OS}`** ✱ | Flutter sends `flutter-{os}` — a framework-OS compound. RN v3 sent the bare framework name. **RN joins Flutter's existing shape**, taking the column from three conventions to two without proposing anything to anyone. ⚠ The domain is `Platform.OS`-derived, **not a closed three-value enum** — RN-Windows emits `react-native-windows`, and a `CHECK` on three values rejects it. |
| Thermal state | `Int 0–6` (`PowerManager`) | `0–3` (`ProcessInfo`) | **not sent** — deferred | ⚠ Not the same axis at different lengths: they **collide where people filter**. `3` is `SEVERE` on Android and `critical` on iOS, so `WHERE thermal_status >= 3` silently mixes them. When RN ships it (§10.3) it will be a **normalized enum string, never an int**. |

⚠ **`session.id`'s suffix domain is `Platform.OS`, not a two-value `ios|android` enum.** RN-Windows and
RN-macOS emit `_windows` / `_macos`. A backend that sizes a two-value column is wrong.

### 7.3 Two keys where one RN key means two things per build

Both are v3 conditions carried into v4 unchanged, and both need an explicit rule:

- **`device.model`** — a model string on native, the **full user-agent string** on web. Cardinality
  hundreds vs **thousands**.
- **`network.type`** — a real connection type on native (~7 values); on web it is
  `NetworkInformation.type`, which is **unimplemented in desktop Chrome, Firefox and Safari**, so the
  value is the constant `"unknown"` outside Chrome-on-Android. This is also why `network_change`
  effectively never fires on web: the emitter compares `type`, and going offline flips
  `network.is_connected`, which it does not look at.

(A third — `memory.source`, `Platform.OS` on native vs the const `"performance.memory"` on web —
**dissolves in v4**, because web stops emitting `memory_usage` entirely.)

---

## 8. Storage: promote or bag, per key

**The bar: a key gets `COL` only if this document can name the query, dashboard, join or `GROUP BY`
that needs it as a column — and states that use.** Everything else is `bag`, with its promotion
trigger written down. The rule alone is not enough: `navigation.*` passes Android's three-clause rule
(join key / bounded dimension / aggregated measure), is promoted, is filled, and lands in a table no
dashboard queries. It bought nothing.

⚠ **Every promote-vs-bag call below is a judgement about *future* volume, not a measurement.** There
are **215 RN 3.0.0 events** in production, 67 of them `http.request`. There is no RN data to validate
a promotion call against, and this document does not pretend otherwise.

### 8.1 `COL` — already shipped

The column exists live (verified in the 2026-09-03 dump) and the processor fills it. No DDL, no ask.

| Key | Column | Named reader |
|---|---|---|
| `user.id` | `rum_users.user_id` | 6 analytics repositories; the identity join |
| `user.name` / `.email` / `.phone` | `rum_users.name`/`.email`/`.phone` | 6 repositories, 2 `ILIKE` paths, a trigram index — **all NULL today**, work-list 5 |
| `session.id` | `rum_sessions.session_id` | `rum_sessions` is the most-read table (101 refs) |
| `session.start_time` | `rum_sessions.start_time` | every time-bounded session query |
| `device.id` | `rum_devices.device_id` | primary dedup key, ahead of `fingerprint`; also the collector's 400 gate |
| `device.platform` | `rum_devices.platform` | every platform-grouped chart ⚠ §1.2 case duplicates |
| `device.platform_version` / `.model` / `.manufacturer` / `.brand` / `.android_sdk` / `.android_release` / `.hardware` / `.product` | `rum_devices.*` | device breakdown panels |
| `app.name` / `.version` / `.build_number` / `.package_name` | `rum_apps.*` | app + tenant segmentation ⚠ §9.3 |
| `network.type` | `rum_sessions.network_type` | connection-quality segmentation |
| `http.method` / `.status_code` / `.duration_ms` / `.success` | `rum_http_requests.*` | 2nd most-read table (41 refs) |
| `error.type` → `exception_type`, `error.message` → `error_message`, `error.stacktrace` → `stack_trace`, `error.source` → `cause`, `error.fatal` → `is_fatal`, `error.breadcrumbs` → `breadcrumbs` | `rum_crash_events.*` | **38 readers** — but see work-list 4 (routing) and §4.9 (naming) |
| `ui.type` / `.target` / `.x` / `.y` / `.name_source` | `rum_ui_interactions.*` | columns exist, `ui_name_source` included ⚠ 0 dashboard readers — your follow-up #3 |
| `screen.name` / `.duration_ms` / `.exit_method` | `rum_screen_durations.*` | 7 refs — **deprecated feed**, do not build new dashboards |
| `navigation.from_screen` / `.to_screen` / `.method` / `.route_type` | `rum_navigations.*` | ⚠ **written, never read** — §4.11 target-table ambiguity |
| `trace.id` / `span.id` / `parent.span.id` / `rum.action.id` / `trace.root_type` / `span.start_time` / `span.duration_ms` | `rum_telemetry_events.*` | the envelope aggregate, §6.6 |
| `metric.unit` | `rum_performance_metrics.unit` | **RN has never sent it** — free win |
| `memory.type` / `.source` | `rum_performance_metrics.memory_type`/`.memory_source` | live and populated |
| `event.name`… | — | see §8.3 |

### 8.2 `COL` — new ask

Fifteen keys, four of which are the work list's DDL items.

| Key | Owner | Target | The query that needs it |
|---|---|---|---|
| `sdk.version` | `ANALYTICS` | `rum_telemetry_events.sdk_version` | **every** query spanning the v3→v4 or 3.0→3.1 boundary — §12 lists twenty breaks separable only by this |
| `event.sequence` | `ANALYTICS` | `rum_telemetry_events.event_sequence` + `UNIQUE (session_id, event_sequence)` | dedup on replay; gap detection for loss |
| `app.build_id` | `ANALYTICS` | `rum_crash_events.app_build_id` | the symbolication resolve join, §4.8 |
| `view.id` | `ANALYTICS` | `rum_telemetry_events.view_id` | the join to `rum_views`; the envelope's derived view |
| `view.name` | `ANALYTICS` | `rum_telemetry_events.view_name` | `GROUP BY view.name` — errors by screen, p95 by screen. The hottest RUM query there is, and denormalized here specifically so it needs no join |
| `http.host` | `ANALYTICS` | `rum_http_requests.host` | first-party vs third-party split; white-label tenant split |
| `http.route` | `ANALYTICS` | `rum_http_requests.route` | "p95 by endpoint", "5xx by endpoint" — *the* HTTP query. **This replaces `rum_http_requests.url`, which §9.1 empties** |
| `session.sample_rate` | `ANALYTICS` | `rum_sessions.sample_rate` | every extrapolated count — §3.6 |
| `ui.rage` / `ui.dead` | `ANALYTICS` | `rum_ui_interactions.ui_rage`/`.ui_dead` | `count(*) FILTER (WHERE ui_rage) GROUP BY view_name`. ⚠ Honest caveat: `rum_ui_interactions` has **zero** dashboard readers today (your follow-up #3), so this is the one place we ask for columns slightly ahead of their reader — two booleans, cheapest possible ask |
| the ten `view.*` event keys | `ANALYTICS` | **`rum_views`** (new) | §4.5 — the whole table |
| `traceparent.outcome` | `PROC`+`ANALYTICS` | `rum_http_requests.trace_injection` retyped `VARCHAR` | `v_trace_attribution_health` already exists and reads it — §6.5 |

### 8.3 `bag` — deliberately, with the promotion trigger named

| Keys | Trigger |
|---|---|
| **All 14 vitals attribution keys** (`vital.*`, `lcp.*`, `inp.*`, `cls.*`) | Promote `vital.rating` and `vital.navigation_type` **first**, once a vitals dashboard exists. A second table for five metric rows per page load, web-only, on a build that emits nothing today is DDL for a dashboard nobody has built — and it would split vitals across two tables so every query becomes a join, for keys that are `@>`-filterable now. `vital.target` is **never** promoted: unbounded cardinality, raw selector. |
| `sdk.events_dropped`, `sdk.drop_reason`, `sdk.hook_dropped`, `sdk.hook_failed`, `sdk.error_count`, `sdk.trace_allowlist_size` | once SDK-health monitoring exists. These are exactly the unread-promotion trap; `@>` filtering is adequate for an alert. |
| `session.sequence` | ⚠ do not promote without §3.5's caveat attached, or someone builds gap detection on a column that cannot gap. |
| `session.reason` | once a session-rotation-cause breakdown exists. Launch counting comes from `app.start`, not from here. |
| `device.orientation`, `.screen_*`, `.cpu_abi`, `.low_ram`, `.id_ephemeral` | once a device-capability or viewport dashboard exists. `device.id_ephemeral` promotes with the first "unique devices" panel that needs to exclude that population. |
| `device.locale`, `.timezone` | Tier C, privacy-adjacent (timezone is a coarse geo proxy). Promote only with a stated purpose. |
| `app.start.js_ready_ms` | once a startup-performance panel exists. Note: `rum_performance_metrics` already carries 171,348 rows under `metric_name = 'app.startup_time'` — that is **simulator output**, not an SDK convention, and RN does not emit it. |
| `app_lifecycle.state`, `network.previous_type` | no reader. |
| `http.request_size`, `http.response_size` | **bag by decision, not omission** — the conformance work removed them from the insert because the live table has no such columns. Asking for them is asking the analytics team for DDL, and no dashboard wants them. |
| `frame.*` (all six) | §7.1 — reported, not proposed. **Do not wait for a rename.** |
| `memory.total_mb` | with the first memory-pressure panel. `rum_performance_events.memory_usage_mb` is on the *event* path RN never sends (§10.4). |
| `ui.tag` | once "we failed to name a real button vs someone clicked a wrapper" is an actual panel. |
| `user.custom.*`, `user.custom_dropped` | `rum_users.profile_data` exists (TEXT) and is the natural home. Now safe to index: the domain is bounded (§4.10) and it rides one event per launch. |
| `view.host` | with the first white-label tenant split. |

**`event.name` on `custom_event`** is the one bag verdict worth arguing against. It has **no column
anywhere**, so the entire public `log()` surface collapses into one indistinguishable row type. The
nameable query is `GROUP BY event.name WHERE event_name = 'custom_event'` — every consumer funnel
there will ever be. It is listed here rather than in §8.2 only because no such dashboard exists yet;
**if you promote one thing beyond the work list, promote this.**

---

## 9. The breaking changes, stated plainly

Two of these will surprise a schema author, and they are stated first for that reason.

### 9.1 ⚠ `http.url` does not merely stop carrying query strings — it is removed

The planning effort's own early framing was *"query strings are stripped from `http.url`"*. That is
**not what shipped in the decision**. Both `http.url` and `http.path` are **removed outright** and
replaced by `http.host` + `http.route` (§4.4).

Query-stripping was rejected because it does not address the threat: the identifier lives in the
**path**, not the query string. `/accounts/GB29-NWBK-6016-1331-9268-19` is a path. Stripping
`?token=…` while shipping that raw means the view name is normalized and the URL two columns over
carries the exact string in the clear.

⚠ **This empties a populated production column.** `rum_http_requests.url` is `NOT NULL` and lives in
the analytics API's **second-most-queried table** (41 references), with **1,389,938 rows**. After v4,
RN writes nothing to it. This is not a chart on a dropped bag key — it is a live column that stops
receiving RN data.

⚠ **`http.path` → `http.route` is not a rename a `COALESCE` can paper over.** The old key's values
were raw paths; the new key's are templates. Any chart or saved filter on either key returns **zero
rows**.

What is given up, so nobody discovers it: **"which exact account produced this 500" is not answerable
from RN telemetry, at any SDK setting.** There is deliberately no `trackViewUrl: 'full'` knob —
`beforeSend` deletes and cannot restore, so the escape hatch is `screenStart(rawUrl)`, where the host
passes the raw string explicitly and owns it.

### 9.2 ⚠ `captureConsole` defaults **off**, and the crash rate moves

In v3 `captureConsole` defaults **on**, so **every `console.error` and every `console.warn` in the
host app — including React's own dev-mode warnings — becomes an `app.crash`**. Any crash-rate metric
computed from v3 `app.crash` volume is meaningless without filtering on `crash.cause`.

In v4:

- The default flips to **off**.
- `console.error`, when enabled, produces **`app.error`** with `error.source: console` — a different
  event name, not just a different cause value.
- **`ConsoleWarn` is deleted from the taxonomy entirely.** A warning is not an error under any
  definition; it becomes a breadcrumb.

⚠ **`app.crash` volume drops sharply on upgrade, and the drop is a correction, not a regression.**
Any dashboard comparing v3 and v4 crash counts without splitting on `sdk.version` will read the fix
as an outage of the reporting pipeline. This is the single strongest reason work-list item 6
(promote `sdk.version`) matters.

### 9.3 `app.packageName` → `app.package_name` ships in `3.1.0`, ahead of v4

This is not an empty column; it is **live cross-tenant misattribution**. `ix_rum_apps_package_name`
is UNIQUE on `package_name` alone, and `repository.go:52` upserts
`ON CONFLICT (package_name) DO UPDATE`. RN sends the camelCase key, so `stringAttr` returns `""` and
**every RN app on the platform, across every tenant, upserts onto one empty-string row** — and the
`DO UPDATE` never touches `tenant_id`, so that row is permanently attributed to whichever tenant
inserted it first. **App-level segmentation does not exist for RN today.**

Seven camelCase Context keys are respelled together in `3.1.0` — `app.buildNumber`,
`app.packageName`, `device.platformVersion`, `device.androidSdk`, `device.androidRelease`,
`device.iosSystemName`, `network.isConnected` — by renaming the `DeviceInfo` / `NetworkInfo`
interface fields, because the camelCase **was never authored**: it is the TS interface shape leaking
through `flattenWithPrefix('', deviceInfo)`. **Five columns start filling. Backend work required:
none.**

⚠ **The fix does not migrate history.** The poisoned empty-string `rum_apps` row and its tenant
attribution survive; real rows begin appearing alongside it from `3.1.0`, so **every `rum_apps`
series steps at that boundary** — which is earlier than v4, and is why the migration note in §12
spans two releases rather than one.

### 9.4 Volume and arrival shape

| | v3 | v4 |
|---|---|---|
| `batchSize` | **2** | **50** (Android's) |
| `flushIntervalMs` | 10 000 | **30 000** (Android's) |
| In-memory queue cap | **none** | 500, drop-oldest, `app.crash` evicted last |
| Offline store cap | **none** | 500 events / 1 MB, same eviction |
| Arrival shape | steady trickle | **bursts** — a drained backlog lands as N back-to-back POSTs |

⚠ **v4 POSTs are ~25× larger and 3× less frequent**, and with one transaction per event a 50-event
batch is a **50-statement transaction**. Cadence matches Android and iOS deliberately: these SDKs feed
**shared tables**, and a per-SDK cadence makes cross-platform arrival comparisons quietly wrong.

⚠ **Pace against the collector's burst ceiling.** 10 req/s means a 50-batch drain 429s at batch 11
(§2.3).

Caps are real, not chosen: Android caps `AsyncStorage` at **6 MB** total, settable only by the
consumer's gradle property; web `localStorage` is the **host app's** ~5 MB. `app.crash` is evicted
last, or a long-offline device evicts exactly the rows §4.7 made trustworthy and **the crash-free rate
reads better the worse the network is**.

### 9.5 `http.method` is uppercased

`buildHttpAttributes` uppercases in v4. Without it the same `fetch(url, {method:'post'})` would yield
`"POST"` on native (whatwg-fetch normalizes for the nine standard verbs) and `"post"` on web, into a
promotion-candidate column — a silently broken `GROUP BY`. ⚠ **A saved filter on
`http.method = 'post'` returns zero rows.** Reporting-only: the SDK never touches the request it
forwards.

---

## 10. What the SDK is **not** changing

The failure this section prevents is mechanical: you see `rum_errors.anr_duration_ms`, see RN in the
SDK list, and build an ANR panel that shows an empty slice forever.

### 10.1 Columns RN will never write

| Table | Column | Why |
|---|---|---|
| `rum_crash_events` / `rum_errors` | `anr_duration_ms`, `hang_duration_ms`, `crash_thread`, `crash_is_main_thread` | **crash capture is JS-level only** (§10.3). A signal handler cannot read the JS carrier, so a native crash would carry no trace keys under any design settled here — and the whole `error.*` payload derives from a JS `Error`'s `name`/`message`/`stack`, none of which a signal handler has. |
| `rum_crash_events` | `error_context`, `product_id`, `error_code`, `user_action`, `severity_level` | Android's positional `trackError` overloads. RN ships one method, `captureError(err, context)`, and `context` carries them at no fixed spelling. Android's own contract lists them as "omitted when unset". |
| `rum_crash_events` | `crash_hash` | ⚠ **`NOT NULL` with no producer, by design.** Backend-computed from §4.8's key. If this document did not say so, routing `app.crash` here would hit a non-nullable column nothing computes. |
| `rum_ui_interactions` | `ui_direction` | **`ui.type`'s domain is closed at `click` \| `tap`.** Gesture capture — swipes, scrolls, pinches, long-presses — is out of scope (§10.5). Do not size this column for RN. |
| `rum_ui_interactions` | `ui_screen` | dropped deliberately — §4.6. `view.name` on Context supersedes it. |
| `rum_screen_durations` | every row, on web | web has never emitted `screen.duration` and will not. Native-only, and **deprecated** (§4.11). |
| `rum_sessions` | `duration_ms`, `event_count`, `metric_count`, `screen_count`, `visited_screens`, `is_first_session`, `total_sessions` | all derived, work-list 13 / §4.2. |
| `rum_performance_events` | `memory_usage_mb`, `memory_pressure_level`, `memory_timestamp` | RN emits `memory_usage` on the **metric** path; these live on the **event** path. §10.4. |
| `rum_performance_metrics` / `rum_performance_events` | `frame_build_duration_ms`, `frame_raster_duration_ms`, `frame_type`, `frame_dropped`, `frame_total_duration_ms`, `frame_severity` | §7.1 — a model difference, not a spelling one. |
| `rum_devices` | `fingerprint` | **deliberately stopped** — §1.2. Zero analytics readers; sending it corrupts device identity. |
| `rum_navigations` / `rum_navigation_events` | `has_arguments` | RN's `navigation.*` has four keys, Android's six. Not adopted, and `navigation` is deprecated anyway. |
| `rum_trace_spans`, `rum_user_actions` | every column | RN writes neither table. Both have **0 rows**; the trace surface lands on `rum_telemetry_events` and `rum_http_requests` (§6.1). |
| — | any `resource.*` or `long_task` key | §10.2. |
| — | `metric_name = 'page_load'` | §10.2. |

**Plus the 35 allowlist keys `extract.go` reads that RN never sends** — enumerate them with the
Appendix A command; every one is a column that stays NULL for RN traffic.

### 10.2 Three event names retired — build nothing for them

⚠ **These are instructions, not omissions. Do not read their absence as "not yet specified."**

- **`page_load`** — its job is done three times over: *a page load happened* → `view` with
  `view.load_type: initial_load`; *how long* → `view.loading_time`; *why slow* → TTFB/FCP/LCP with
  the phase splits. Reviving it would emit a third row about the same moment and force you to be told
  which of the three is authoritative.
- **`resource_timing`** — same test. What was left is per-asset font/CSS/image rows: hundreds per
  asset-heavy view, in a namespace with no column, on **one platform of four**. A single such view
  would exceed the 500-event in-memory queue on its own and starve the events people dashboard.
- **`long_task`** — and the tempting "keep bare `longtask` as a fallback" is a **false option**:
  `PerformanceLongTaskTiming` and `long-animation-frame` are **both Chromium-only**, so the fallback
  buys Chrome 58–122, not one non-Chromium user. Jank *detection* is already universal via
  `frame_render_time` (a >50 ms long task **is** a long rAF delta), and the user-visible consequence
  is already measured by INP's phase split.

Uniquely among v4's changes, these three add **nothing** to the migration story: none was ever
produced, so no chart exists on any of them.

### 10.3 Deferred as one bundle — native-module capture

`device.cpu_cores`, `device.thermal_status`, `device.battery_level`, `device.battery_charging`,
`device.power_save`, `app.exit` and its keys, native signal/ANR/hang capture, and a synchronous
crash store.

The rule: **anything needing the SDK's first native module defers, and is priced against the whole
native surface rather than against itself.** That cost is not "write a module" — it is a change to how
the package ships: Kotlin and Swift sources in a repo whose CI runs only `npm ci`/typecheck/test/build,
a **TurboModule spec** or New Architecture consumers break, and an **Expo config plugin** or Expo Go
consumers cannot install the SDK at all, which today they can because it is pure JS.

⚠ **The JS dirty-flag approximation of `app.exit` is rejected on the record**, so it is not proposed
later as the cheap win. Writing a marker on init and clearing it on clean background is pure JS and
cross-platform — but it detects *abnormal termination* without naming the cause, and on mobile the
dominant cause is **the user force-quitting**, which is not a fault. The metric would not merely be
thin, it would **invert**: healthy apps with engaged users would score worst.

`storage_usage` is out entirely, and not deferred: two of Android's five keys are already waste by
this contract's own rules (`storage.tracking_method` is a hardcoded constant, `storage.api_level`
duplicates `device.android_sdk`), and its best argument — a full disk silently eating the offline
store — **cannot detect its own use case**, since the reporting event goes through the same failing
path.

### 10.4 Three keys RN keeps despite their being wrong

Each is a live trap, and each is kept for a stated reason:

- **`frame.*`'s names** — §7.1. Report, propose nothing. **The backend must not wait for a rename.**
- **`session.sequence`'s name** — §3.5. It counts batches acknowledged before the event was logged.
  Kept for iOS parity; the warning travels with it forever.
- **`memory.pressure_level` is dropped, and it was never landing anyway.** It is read only by
  `extractPerformanceEvent`, gated on `frame.summary` / `memory_pressure` — event names RN has never
  emitted. **RN's own key, in the schema, unreachable by RN**, for every sample ever sent. Promotion
  happened per-*path*, not per-key.

### 10.5 Capabilities ruled out — appendix, not roadmap

One line each, so a reader stops looking:

- **Gesture capture beyond activation** (swipes, scrolls, pinches, long-presses, and Android's
  `ui.direction`). Needs `react-native-gesture-handler` as a new native peer plus a pointer state
  machine on web.
- **Native-module HTTP capture** — intercepting OkHttp / NSURLSession so traffic that never touches
  JS reaches `rum_http_requests`. Adds **no key, no column, no type and no cardinality** — only a
  second source populating an existing table. A capture-coverage roadmap item, not a wire-contract one.
- **The source-map build plugin and upload endpoint.** How a map travels from Metro to storage is
  build tooling. The wire half is paid in full by §4.8.
- **The symbolication enrichment pipeline's design** — when the resolve pass runs, retry policy, map
  storage and retention, cache invalidation. Backend implementation; §4.8 pays the contract's whole
  debt to it.
- **Per-asset resource timing and main-thread script attribution.** §10.2. Real capabilities given
  up, not oversights.
- **Session Replay.** A product effort with its own destination and owner.
- **A canonical cross-SDK `frame.*` model.** §7.1.

---

## 11. Deployment prerequisites

### 11.1 Authentication — RN sends both headers, always

`apiKey` widens from *"the API key"* to *"the credential"*, and every POST carries both
`X-API-Key: <cred>` and `Authorization: Bearer <cred>`. `credentialFromRequest`
(`handler.go:187-192`) reads `Authorization` when `AUTH_MODE=jwt` and `X-API-Key` otherwise — exactly
one, never the other — so **one request body works in both topologies with no mode flag, no shape
sniffing and no new config field.** The two credential shapes are disjoint by construction
(`edge_<id>_<secret>` splits into ≥3 `_`-parts, `edge_<jwt>` does not), and `Verify`'s
`TrimPrefix(rawToken, "edge_")` (`jwt.go:81`) shows the platform already intends the JWT to be an
`edge_`-prefixed opaque string.

⚠ **This was never an RN defect. All four SDKs send only `X-API-Key`** — iOS asserts it and nothing
else, Android has no `Authorization` match — **so the segmented deployment currently accepts telemetry
from zero SDKs.** RN's dual-header approach is available to copy; per *report, don't propose*, no
other SDK owner is asked to change.

**Three prerequisites for a segmented (bank / on-prem) deployment:**

1. **A token.** RS256, `kid` header matching a `<kid>.public.pem` in the DMZ's `JWT_PUBLIC_KEYS_DIR`,
   claims `tenant_id` + `app_id` + `jti` all non-empty, and **no `exp`**.
   ⚠ **The credential must not expire, and this is a requirement on the issuer rather than code in
   the SDK.** `ParseWithClaims` is called without `WithExpirationRequired()` (`jwt.go:104`), so a
   token omitting `exp` verifies indefinitely — and that is what the contract needs: configuration is
   constructor-only so there is no rotation surface; the offline store replays arbitrarily late across
   app restarts, so a batch signed under a token that dies before replay 401s forever; and `jti` is
   required but has **no replay store and no revocation path**, so a short `exp` enforces nothing that
   actually exists.
   ⚠ **Nothing currently mints this token.** The bank compose runs the processor alone and no
   container mounts `jwt-signing-keys`; the collector exposes no token route. `README.md:85`'s *"Bank
   holds private key (signs)"* describes an intent, not a running component. Filed upstream as
   [`EdgeTelemetryDeploymentGo#1`](https://github.com/NCG-Africa/EdgeTelemetryDeploymentGo/issues/1),
   because it blocks Android, iOS and Flutter identically.
2. **`CORS_ALLOWED_ORIGINS` must be set** if the RN Web build is used. `routes.go:18` installs CORS
   middleware only when it is non-empty, it defaults to empty, and **neither deployment sets it** — so
   ⚠ **RN Web is blocked cross-origin in both topologies, before auth is even reached.** The header
   allowlist itself is already correct (`Authorization`, `X-API-Key`, `Content-Type`), so the second
   auth header costs no preflight change; the middleware just has to be switched on.
3. **The path is `POST /telemetry`.** ⚠ **`/collector/telemetry` exists in no artifact** — not the Go
   collector, not the Python predecessor, not either deployment topology, and there is no proxy. It
   appears only in this repo's own `README.md:88,103`, which we are correcting. A consumer copying our
   previously-documented endpoint gets a 404 on every batch.

`assertApiKey` deliberately does **not** tighten to the collector's ≥3-part check: under a widened
credential that would hard-reject every `edge_<jwt>` and make the bank deployment unreachable — the
exact bug this fix exists to close, re-created by its own fix. It validates prefix plus a non-empty
remainder; the real catch is the 401 warn, which is strictly better because it catches typo,
revocation, wrong tenant, wrong mode and wrong credential type alike.

### 11.2 What a 2xx does and does not mean

⚠ **A 2xx does not mean stored.** The processor opens **one transaction per event**
(`service.go:106`), the schema is aggressively `NOT NULL`, and a failed event is `slog.Warn` +
`continue`. Migration `0004_processor_dead_letter_events` softens this substantially — per-event
failures are now captured with their raw JSON and error, replayable via `POST /dead-letter/replay`,
rather than vanishing. **Two batch-level paths still commit the offset with only a WARN**: an
unparseable envelope, and a missing `tenant_id` (§2.3).

This is why §3.6's Tier A exists and is **enforced by re-stamping rather than documented**: a consumer
whose `beforeSend` strips `app.version` or `device.id` would otherwise get every event silently
discarded behind a success response.

---

## 12. Migration — twenty discontinuities across two releases

Every one of these is separable **only by `sdk.version`**, which is work-list item 6. ⚠ And
`sdk.version` is **absent from the bag on 4,145,161 of 4,146,233 historical rows** (the empty-bag rows
are simulator output, not lost data), so telling a consumer to split a historical series on it is
telling them to split on a key their data does not have. **Promoting it going forward is the only
version of this that works.**

### 12.1 Ships in `3.1.0`, ahead of v4 (3)

| # | Change | Effect |
|---|---|---|
| 1 | Seven camelCase Context keys respelled | any bag query on the old spellings returns zero rows; **five columns start filling**; ⚠ every `rum_apps` series **steps** at this boundary (§9.3) |
| 2 | `getDeviceInfo()` / `getNetworkInfo()` return shapes change | **the map's first consumer API break** — structural only, never a compile error on an imported name, since the `DeviceInfo` type is not importable |
| 3 | `app.packageName` → `app.package_name` | stops an **active cross-tenant corruption**; does **not** migrate history |

### 12.2 v4 — keys that disappear (6)

| # | Change | Effect |
|---|---|---|
| 4 | **`http.url` removed** | ⚠ empties `rum_http_requests.url`, a **populated production column** in the 2nd most-queried table |
| 5 | **`http.path` removed** | not a rename a `COALESCE` can paper over — raw values vs templates |
| 6 | `user.name` / `.email` / `.phone` leave the Context block | any bag query filtering **events** on them returns zero rows; they now ride `user.profile.update` only |
| 7 | Six `user.*` keys vanish outright | `fullName`, `firstName`, `lastName`, `avatar`, `createdAt`, `updatedAt` |
| 8 | `device.iosDeviceName` vanishes | PII removal |
| 9 | **Web loses `memory_usage` entirely** | the metric's presence was browser detection wearing a memory label |

### 12.3 v4 — values that change under an unchanged key (7)

| # | Change | Effect |
|---|---|---|
| 10 | `sdk.platform`: `react-native` → `react-native-{Platform.OS}` | ⚠ a saved filter on `sdk.platform = 'react-native'` returns **zero rows** — the worst way for a chart to fail |
| 11 | `memory.type`: `"heap"` → `"rss"` | ⚠ on a **promoted column**, with real v3 Hermes data to be silently compared against |
| 12 | `http.request_size`: UTF-16 units → **UTF-8 bytes** | any non-ASCII traffic's payload-size series steps up **2–3×** |
| 13 | `session.id` gains `_web` on the web build | value shape changes; nothing parses it |
| 14 | `error.source` re-cuts `crash.cause` | ⚠ a **migration table, not a rename** — §4.7 |
| 15 | `http.method` uppercased | a saved filter on `'post'` returns zero rows — a *correction* |
| 16 | `frame.dropped_count` values move on 90/120 Hz devices | a *correction*: the v3 numbers were the wrong ones |

### 12.4 v4 — counts that step (4)

| # | Change | Effect |
|---|---|---|
| 17 | **Session counts drop sharply** | resume-across-process-death replaces per-launch minting. RN native processes are killed constantly. |
| 18 | **Every native device gets a new `device.id`** | device counts double across the boundary **once**, with no v3↔v4 device join available |
| 19 | **`user.id` vanishes from anonymous traffic** | any "users" chart that does not filter drops to the **identified population**, a small fraction for most consumers |
| 20 | **RN-Android device counts step up** | previously-merged handsets un-merge as `device.fingerprint` stops being sent — a *correction* of a real undercount, and the only entry on this list where the v3 numbers were the wrong ones in that direction |

### 12.5 v4 — arrival changes, not content changes

Not counted among the twenty, but they change what your ingest sees: **burst arrival**, **~25×-larger
and 3×-rarer POSTs**, and **at-least-once duplicates until the `(session_id, event_sequence)` dedup
index exists**. ⚠ **That last one is a rollout-ordering question: the index should land before or with
the SDK, not after.** Until it does, replay inflates every aggregate.

⚠ **And two volume changes that are not breaks but will look like incidents:** `http.request` volume
goes **zero → everything** for axios-based tenants (§4.4), and `screen.duration` volume goes **up**
for React Navigation consumers at the exact moment it is deprecated (§4.11).

Of the twenty, **only #2 and the six `@deprecated` public fields are visible to a consumer at compile
time.** Everything else surfaces at runtime or in a chart.

---

## 13. Five deliberate departures from "borrow Android"

RN adopts Android's key names wherever the concept already exists there — `trace.*`, `span.*`,
`rum.action.id`, `traceparent.outcome`, `navigation.*`, `screen.*`, `ui.*`, the bag-first storage
model and the promotion rule. Five places diverge on purpose. Each is argued in its own section; they
are collected here so their absence from Android's contract does not read as an omission.

| # | Departure | Section | The argument in one line |
|---|---|---|---|
| 1 | **`error.*` dotted, not Android's undotted `message`/`cause`/`is_fatal`** | §4.9 | RN's bag is one flat namespace shared with 124 keys and `log()` flattens caller data into it, so `message` and `cause` collide with userland |
| 2 | **`sessionSampleRate`** | §3.6 | Android's `traceSampleRate` is per-*trace* and pinned at `1.0`; a per-trace sampler produces orphan children (§6.7) |
| 3 | **`http.route`, not a normalized `http.path`** | §4.4.1 | one column, two dialects, nothing in the data to separate them |
| 4 | **`user.id` omitted on anonymous traffic; `device.id` carries anonymous identity** | §3.2 | Android mints both ids the same way into the same store, so its two columns carry one fact. The departure is in *naming*, not storage |
| 5 | **`user.*` profile keys leave the Context block for `user.profile.update`** | §4.10 | Android persists its profile; RN's is in-memory, and shipping PII on every event to fill a table that needs it once is indefensible |

Smaller stated divergences, each in place: `injected_unwired` dropped (§6.5); `b3` declined (§6.4);
`hostname` matching vs `http.host`'s port (§6.4); `__DEV__`-gated allowlist validation vs Android's
unconditional `require` (§6.4); malformed consumer headers left alone rather than repaired (§6.5);
`ui.screen` dropped (§4.6); `error.handled` dropped (§4.7); breadcrumb cap 20 against Android's 50
(§4.7); `app.start.js_ready_ms` rather than `duration_ms` (§4.3).

---

## Appendix A — reproduce every number

### A.1 The v3 key count (73)

Two sources, because the SDK builds attribute keys two ways: string literals at emit sites, and
object property names flattened out of the `DeviceInfo`/`NetworkInfo` interfaces. A grep for literals
alone misses all 19 `app.*`/`device.*`/`network.*` Context keys.

```bash
git -C . checkout 4f92c16
{
  # (a) literal keys at emit sites:  "k.v": …   |   attributes['k.v'] = …
  grep -rhoE "[\"'][a-z][a-zA-Z0-9_]*(\.[a-z][a-zA-Z0-9_]*)+[\"'][[:space:]]*(:|\][[:space:]]*=)" \
    src --include='*.ts' --exclude='*.test.ts' \
    | sed -E "s/[\"'][[:space:]]*(:|\][[:space:]]*=)\$//; s/^[\"']//"

  # (b) Context keys the flattener derives from the interfaces
  awk '/^export interface (DeviceInfo|NetworkInfo)/,/^\}/' src/core/telemetry.ts \
    | awk '
        /^export interface NetworkInfo/            { p="network"; next }
        /^    (app|device):[[:space:]]*\{/         { p=$1; sub(":","",p); next }
        /^    \};?$/                               { if (p!="network") p=""; next }
        p && /^ +[a-zA-Z]+\??:/                    { k=$1; sub(/\??:.*/,"",k); print p"." k }
      '
} | sort -u > /tmp/rnkeys.txt

wc -l < /tmp/rnkeys.txt        # 73
```

⚠ **Two traps.** Drop the `:` / `] =` anchor and event names contaminate the set — they appear as
`log("app.crash", …)` and as bare `ALLOWED_NAMES` members, never followed by a colon. Drop part (b)
and all 19 Context keys vanish, because they are never string literals. Doing both gives **63**,
which is wrong in both directions: eight non-keys mixed in and eighteen real keys missing.

### A.2 Where a v3 key lands (30 / 26 / 43)

```bash
P=/path/to/EDGETELEMETRYPROCESSORGO && git -C "$P" checkout 516a02f

# processor allowlist — 67 distinct dotted names
grep -oE '"[a-z_]+\.[a-z_.]+"' "$P/internal/telemetry/extract.go" \
  | tr -d '"' | sort -u > /tmp/allowlist.txt

wc -l < /tmp/allowlist.txt                             # 67
comm -12 /tmp/rnkeys.txt /tmp/allowlist.txt | wc -l    # 32 name-matched (30 reachable)
comm -23 /tmp/rnkeys.txt /tmp/allowlist.txt | wc -l    # 41 no match (+2 unreachable = 43 bag-only)
comm -13 /tmp/rnkeys.txt /tmp/allowlist.txt | wc -l    # 35 columns RN never fills — §10.1
```

⚠ **The dotted grep misses `extractError` entirely** — its fourteen keys are undotted (`message`,
`is_fatal`, `anr_duration_ms`, …), so they never appear in `allowlist.txt`. They are not a coverage
gap in the arithmetic sense, but leaving them out would hide §4.9.

⚠ **Reachability is not derivable from `comm` alone.** A name-match only lands if the event reaches
the extractor that reads it; the dispatch is `service.go:240-279`. Two keys
(`memory.usage_mb`, `memory.pressure_level`) are promoted on a path RN never sends — §10.4.

### A.3 Which tables the product actually reads

```bash
A=/path/to/edge_telemetry_rum_analytics && git -C "$A" checkout 264732f
grep -rhoE "(FROM|JOIN) rum_[a-z_]*" "$A/app" | sed -E 's/^(FROM|JOIN) //' | sort | uniq -c | sort -rn
grep -rn "attributes" "$A/app" | grep -v from_attributes    # empty — the bag has no reader
```

Counts at `264732f`: `rum_sessions` 101, `rum_http_requests` 41, `rum_crash_events` 38,
`rum_geo_locations` 15, `rum_screen_durations` 7, `rum_navigation_events` 3, and **`rum_errors` 0,
`rum_navigations` 0, `rum_ui_interactions` 0**.

### A.4 The live schema, the enum labels and the row counts

Every "already shipped" verdict in §8.1, the six `trace_injection_outcome` labels in §6.5, the row
counts in §4.11 and §6.1, and the 4,146,233 / 4,145,161 bag figures in §12 all come from one
read-only introspection:

- **Dump:** [`docs/introspection/edge-db-live-schema.md`](./introspection/edge-db-live-schema.md)
  (2026-09-03, all 29 `rum_*`/`processor_*` tables and 4 views)
- **Reproduce:** [`docs/introspection/introspect_edge_db.sql`](./introspection/introspect_edge_db.sql)

### A.5 The v4 key count (125)

This is an **enumeration of this document's own tables**, not a grep of code that does not exist yet.
Re-derive it as: §3.3 (39 Context) + §4.1 (4) + §4.2 (3) + §4.3 (1) + §4.0's `app_lifecycle` (1) +
§4.5 (10) + §4.11 (4 + 3) + §4.4 (9, incl. `traceparent.outcome`) + §4.7 (6) + §4.6 (8) +
`network.previous_type` (1) + §4.10 (4) + `event.name` (1) + §5.1 (6) + `metric.unit` (1) + §5.2 (3) +
§5.3 (14) + §6.1 (7) = **125**, plus the bounded `user.custom.*` namespace.

Cross-check against v3: **52 of v3's 73 keys survive, 21 are retired, 73 are new.** 52 + 73 = 125.

### A.6 Confirming what RN actually sends today

215 RN 3.0.0 events landed in `rum_telemetry_events` between 2026-08-30 and the introspection date,
and they corroborate §A.1 key-for-key. They independently confirm three claims in this document:
`frame.target_hz` still ships pre-§5.1's rename; `user.fullName`/`createdAt`/`updatedAt` still ship
pre-§3.4's removal; and `http.host`/`http.path` are present on all 67 http rows. Detail in the dump's
§5.

---

## Appendix B — the four names needing sign-off

Anything not on `ALLOWED_NAMES` is rewritten to `custom_event` on the SDK side and dropped on ingest,
so these are a hard dependency for everything above.

| Name | Type | Builds | What it carries | Section |
|---|---|---|---|---|
| **`view`** | event | both | the ten view-exit keys — and it is **web's entire name-level ask** | §4.5 |
| **`ui.interaction`** | event | both | the eight `ui.*` keys. Replaces `user.interaction`, which Android already retires; columns are **already built** | §4.6 |
| **`app.error`** | event | both | handled / non-fatal errors, so `COUNT(event_name='app.crash')` stays an honest unfiltered crash count | §4.7 |
| **`app.start`** | event | both | one nullable attribute; carries the `launch` trace root and is how app launches are counted | §4.3 |

**Retired in the same release:** `user.interaction`, `page_load`, `resource_timing`, `long_task`.
**Net allowlist delta: zero.**
