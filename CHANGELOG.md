# Changelog

All notable changes to `@nathanclaire/edge-telemetry-sdk` are documented here.

## 3.0.0

**Breaking wire change.** v3 conforms to the shared EdgeRum / EdgeTelemetryProcessor
contract — the same backend the web, Android (Ionic) and iOS SDKs feed. The v2 wire
format is removed, not flag-gated (single clean break, no dual-emit). Upgrade deliberately,
once.

### Breaking

- **Package renamed.** Published as **`@nathanclaire/edge-telemetry-sdk`** (scoped under the
  org), replacing the unscoped `edge-telemetry-sdk` (last at 2.1.0, now deprecated). Update
  your install and imports:
  `npm install @nathanclaire/edge-telemetry-sdk` /
  `import { createTelemetry } from "@nathanclaire/edge-telemetry-sdk"`.
- **`apiKey` is now required.** `createTelemetry({ apiKey, endpoint, ... })` — the key must
  start with `edge_`; init throws otherwise. Sent as the `X-API-Key` header. `tenant_id` is
  never sent (the backend resolves the tenant from the key).
- **Batch envelope.** The POST body is now
  `{ type: "telemetry_batch", timestamp, batch_size, events }` POSTed to the `endpoint` you
  configure — no longer a bare `{ events }` array.
- **ISO-8601 timestamps.** Event and batch `timestamp` are ISO-8601 strings (was ms epoch).
- **ID formats.** `device_{ms}_{16hex}_{os}`, `session_{ms}_{16hex}_{os}` (suffix = device
  OS), `user_{ms}_{16hex}` (no suffix). 16 hex chars of entropy (was 8, no suffix).
- **Context-as-attributes.** Device/network/app/session/user/sdk data now rides as a flat,
  dot-namespaced Context block on **every** event and metric. The standalone `device_info`
  and `network_info` events are removed.
- **Event renames + allowlist.** `network_request`→`http.request`,
  `network_info_change`→`network_change`, `screen_view`/`screen_end`→`navigation` +
  `screen.duration`, `frame_drop`→`frame_render_time`. Only the 12-name allowlist ships; any
  other `log()` name rides as `custom_event` with the original name in `event.name`.

### Added

- Unified `app.crash` with a `cause` discriminator and `crash.breadcrumbs` (last 20 actions).
- Session lifecycle: `session.started` / `session.finalized`, 30-minute idle rotation, and
  `session.sequence` (incremented per acknowledged batch).
- `app_lifecycle` events on foreground/background transitions.
- `identify()` → `user.profile.update`, attaching `user.name`/`email`/`phone` while
  preserving the anonymous `user.id`.
- Native metrics: `memory_usage` and `frame_render_time`.
- Best-effort native `user.interaction` (tap) events — spread `await telemetry.interactionProps()`
  on your app root `<View>`.
- `debug` option (default `false`) — gates all SDK-internal console output so v3 doesn't spam
  the host app's logs. Set `createTelemetry({ debug: true })` to see diagnostics.

### Preserved

- Retry with backoff + persisted replay of failed batches (AsyncStorage native /
  localStorage web), replayed on next init.

### Migration

1. Add `apiKey` (starting with `edge_`) to `createTelemetry`.
2. Set `endpoint` to the **full** collector URL, e.g.
   `https://collector.example.com/collector/telemetry` — it is used verbatim as the POST URL.
3. Drop any consumer code that read the standalone `device_info`/`network_info` events; that
   data now rides on every event's `attributes`.
4. If you called `log()` with custom names, they now arrive as `custom_event` with your name
   in `event.name`.
