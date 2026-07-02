# @nathanclaire/edge-telemetry-sdk

[![npm version](https://img.shields.io/npm/v/@nathanclaire/edge-telemetry-sdk.svg)](https://www.npmjs.com/package/@nathanclaire/edge-telemetry-sdk)
[![React Native](https://img.shields.io/badge/React%20Native-0.64%2B-61DAFB.svg?style=flat&logo=react)](https://reactnative.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-3178C6.svg?style=flat&logo=typescript)](https://www.typescriptlang.org/)

A lightweight Real User Monitoring (RUM) SDK for **React Native** apps (and a web build via
React Native Web). It captures performance, errors, network requests, device/network context,
navigation and user interactions, then ships them as JSON to the shared **EdgeTelemetryProcessor**
backend — the same backend the web, Android (Ionic) and iOS SDKs feed.

One SDK, two builds. The bundler picks `index.native.js` or `index.web.js` from the
`package.json` `exports` map — you always import from `@nathanclaire/edge-telemetry-sdk`.

---

## Contents

- [Upgrading to v3](#upgrading-to-v3-breaking)
- [Install](#install)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [API](#api)
- [What gets captured](#what-gets-captured)
- [Wire format](#wire-format)
- [Identity & IDs](#identity--ids)
- [Reliability](#reliability)
- [Debugging](#debugging)
- [Development](#development)

---

## Upgrading to v3 (breaking)

v3 is a **single clean break** onto the EdgeRum wire contract — no dual-emit, no v2 fallback.
If you're coming from v2, the headlines:

- `createTelemetry({ apiKey, endpoint, ... })` — **`apiKey` is now required** (must start with
  `edge_`; sent as `X-API-Key`; init throws otherwise).
- The POST body is the `telemetry_batch` envelope; timestamps are ISO-8601; device/network data
  rides as a Context block on **every** event (the standalone `device_info`/`network_info`
  events are gone).
- Several event names changed and only the allowlist ships (`network_request` → `http.request`,
  `screen_view` → `navigation`, …); other `log()` names arrive as `custom_event`.
- New `debug` option (default `false`) silences all SDK console output.

Full breaking-change list and migration checklist: **[CHANGELOG.md](./CHANGELOG.md)**.

---

## Install

```bash
npm install @nathanclaire/edge-telemetry-sdk
```

### React Native peer dependencies

Native capture relies on these (install in your app):

```bash
npm install @react-native-async-storage/async-storage react-native-device-info @react-native-community/netinfo
cd ios && pod install
```

| Peer dep | Used for |
|---|---|
| `@react-native-async-storage/async-storage` | persisted replay of failed batches |
| `react-native-device-info` | `device.*` context (optional — degrades gracefully) |
| `@react-native-community/netinfo` | `network.*` context + `network_change` |

The **web build** uses browser APIs (`navigator`, `localStorage`) and needs none of the above.

---

## Quick start

`createTelemetry()` returns a `TelemetryNative` or `TelemetryWeb` instance — the bundler chooses.
**Every public method is `async`** (each awaits a lazily-built core), so `await` your calls.

### React Native

```typescript
import { createTelemetry } from "@nathanclaire/edge-telemetry-sdk";

const telemetry = createTelemetry({
  apiKey: "edge_xxxxxxxx",                                  // required; must start with "edge_"
  endpoint: "https://collector.example.com/collector/telemetry", // full POST URL, used verbatim
  batchSize: 20,
  flushIntervalMs: 10000,
});

await telemetry.log("checkout_started", { cart_value: 42 });
```

### React Web

```typescript
import { createTelemetry } from "@nathanclaire/edge-telemetry-sdk";

const telemetry = createTelemetry({
  apiKey: "edge_xxxxxxxx",
  endpoint: "https://collector.example.com/collector/telemetry",
  batchSize: 20,
  flushIntervalMs: 10000,
});

await telemetry.log("checkout_started", { cart_value: 42 });
```

Once constructed, the SDK **auto-starts** its collectors — you don't wire them up: session start,
crash/error capture, HTTP interception, frame + memory sampling, app foreground/background, and
(web) navigation. You only opt in to navigation and interaction capture on native (below).

---

## Configuration

```typescript
type TelemetryOpts = {
  apiKey: string;           // REQUIRED — must start with "edge_"; sent as X-API-Key
  endpoint?: string;        // full collector POST URL (used verbatim). Default is a placeholder — always set it
  batchSize?: number;       // events per flush. Core default 2 — set higher (e.g. 20) for production
  flushIntervalMs?: number; // periodic flush. Default 10000; <= 0 disables the timer
  captureConsole?: boolean; // funnel console.error/warn into app.crash. Default on (opt-out)
  debug?: boolean;          // SDK-internal console diagnostics. Default false (silent)
  sender?: Sender;          // override the transport (mainly for tests)
};
```

- **`apiKey`** is validated at `createTelemetry()` — a key not starting with `edge_` throws
  immediately, so misconfiguration fails fast instead of silently dropping data. `tenant_id`
  is never sent; the backend resolves the tenant from the key.
- **`endpoint`** is the exact URL the SDK POSTs to. Point it at your collector's telemetry path.

---

## API

All methods return Promises. Available on both platforms unless marked **native-only**.

### Core

```typescript
log(event: string, data?: Record<string, any>): Promise<void>   // custom event (see allowlist note)
flush(): Promise<void>                                           // force-send the queue now
shutdown(): Promise<void>                                        // clear the flush timer + final flush
```

> **Allowlist note:** only the allowlisted event names reach the backend as-is. Any other name
> you pass to `log()` is shipped as `custom_event` with your original name in
> `attributes["event.name"]` — so custom events are preserved, not dropped.

### Identity

```typescript
identify(profile: {                     // EdgeRum-style — emits user.profile.update,
  name?: string; email?: string;        // attaches identity to subsequent events, and
  phone?: string; avatar?: string;      // PRESERVES the anonymous user.id
  customAttributes?: Record<string, any>;
}): Promise<void>

setUserId(id: string): Promise<void>
generateUserId(): Promise<string>
setUserProfile(profile): Promise<void>
setUserDetails(details): Promise<void>          // fullName/firstName/lastName/email/phone/avatar/customAttributes
updateUserProfile(updates): Promise<void>
getUserProfile(): Promise<UserProfile | undefined>
clearUserProfile(): Promise<void>
setUserName(fullName, firstName?, lastName?): Promise<void>
setUserContact(email?, phone?): Promise<void>
```

```typescript
await telemetry.identify({ name: "Ada Lovelace", email: "ada@example.com" });
```

### Context accessors

```typescript
getDeviceInfo(): Promise<DeviceInfo>
getNetworkInfo(): Promise<NetworkInfo>
```

### Navigation & screens — **native-only**

```typescript
attachNavigation(navigationRef): Promise<void>   // React Navigation container ref → auto route tracking
trackRoute(from: string, to: string): Promise<void>
screenStart(name: string): Promise<void>         // → navigation
screenEnd(name: string): Promise<void>           // → screen.duration (dwell ms)
```

```typescript
import { NavigationContainer, useNavigationContainerRef } from "@react-navigation/native";

const navRef = useNavigationContainerRef();
// after the container mounts:
await telemetry.attachNavigation(navRef);
```

On **web**, navigation is auto-tracked (History API) — no wiring needed.

### User interactions (taps) — **native-only, best-effort**

Native has no global tap stream, so the SDK gives you responder props to spread on your app root.
Each tap emits `user.interaction` with `interaction.type` and the current screen when known. It
observes the gesture without stealing it (no DOM `target_tag`/`target_class` — those are web-only).

```tsx
function Root() {
  const [props, setProps] = React.useState({});
  React.useEffect(() => { telemetry.interactionProps().then(setProps); }, []);
  return <View style={{ flex: 1 }} {...props}><App /></View>;
}
```

---

## What gets captured

Auto-started in the constructor (both platforms unless noted):

| Signal | `eventName` / `metricName` | Type |
|---|---|---|
| Session start / end | `session.started`, `session.finalized` | event |
| App foreground/background | `app_lifecycle` | event |
| Route change / screen entry | `navigation` | event |
| Screen dwell time | `screen.duration` | event |
| HTTP request (fetch/XHR) | `http.request` | event |
| Connectivity change | `network_change` | event |
| JS error / crash / (opt-out) console errors | `app.crash` | event |
| Identity update via `identify()` | `user.profile.update` | event |
| Tap (native, best-effort) | `user.interaction` | event |
| Custom `log()` name (non-allowlisted) | `custom_event` | event |
| Memory sample | `memory_usage` | metric |
| Frame render window | `frame_render_time` | metric |

`app.crash` carries a `cause` discriminator and `crash.breadcrumbs` (last 20 actions,
JSON-stringified). Sessions rotate after 30 minutes of inactivity; `session.finalized` flushes
immediately and includes a journey summary + `sdk.error_count`.

**Web-only signals** (`page_load`, `resource_timing`, `long_task`, and Web Vitals
LCP/FCP/CLS/INP/TTFB) are emitted only by the web build — native never reports metrics it can't
honestly measure.

---

## Wire format

```
POST <endpoint>
Content-Type: application/json
X-API-Key: edge_xxxxxxxx

{
  "type": "telemetry_batch",
  "timestamp": "2026-07-02T06:00:00.000Z",   // ISO 8601
  "batch_size": 3,
  "events": [ /* TelemetryEvent, ... */ ]
}
```

Each event/metric:

```typescript
type TelemetryEvent = {
  type: "event" | "metric";
  eventName?: string;                  // events
  metricName?: string;                 // metrics
  value?: number;                      // metrics
  timestamp: string;                   // ISO 8601
  attributes?: Record<string, any>;    // flat, dot-namespaced — includes the Context block
};
```

Every record carries the flattened **Context block** in `attributes`: `app.*`, `device.*`,
`network.*`, `session.*`, `user.id`, and `sdk.*` (`sdk.platform = "react-native"`,
`sdk.version`). This makes each record self-describing and joinable without correlating against
separate context events.

---

## Identity & IDs

IDs use 16 hex chars of entropy; device/session are suffixed with the device OS, user is not:

```
device_{ms}_{16hex}_{ios|android}
session_{ms}_{16hex}_{ios|android}
user_{ms}_{16hex}
```

Conform to `^(session|device|user)_\d+_[0-9a-f]{16}(_(ios|android))?$`. The **web build** omits
the OS suffix (`device.platform = "web"` still rides as an attribute).

`identify()` attaches host-app identity (`user.name`/`email`/`phone`) to subsequent events and
emits one `user.profile.update` — it never changes the SDK-owned anonymous `user.id`.

---

## Reliability

- **Batching:** events queue and flush when `batchSize` is reached or every `flushIntervalMs`.
- **Retry:** failed sends retry with exponential backoff + jitter.
- **Persisted replay:** after final failure, batches are persisted (AsyncStorage on native,
  `localStorage` on web, key `telemetry_failed_events`) and replayed on next init — telemetry
  survives transient network loss.
- **Web unload:** the web sender uses `fetch({ keepalive: true })` (not `sendBeacon`, which can't
  set the required `X-API-Key` header) so in-flight batches survive page unload.

---

## Debugging

The SDK is **silent by default**. To see its internal diagnostics while developing:

```typescript
createTelemetry({ apiKey: "edge_xxx", endpoint: "...", debug: true });
```

`debug: true` routes the SDK's `log`/`warn`/`error` to the console; with it off (the default),
the SDK writes nothing to the host app's console.

---

## Development

```bash
npm run build      # vite build → dist/ (web + native entries, ESM + CJS)
npm run dev        # vite in watch mode
npm test           # vitest run
npm run typecheck  # tsc --noEmit
npm run clean      # remove dist/
```

`dist/` and `*.tgz` are git-ignored — `dist/` is regenerated by the build and published via the
`package.json` `files` list. `prepare` runs the build, so installing this as a git dependency
builds it automatically.

Platform code is split by filename (`*.native.ts` / `*.web.ts`), not by runtime branching — the
bundler selects the file. When adding a capability, keep the native and web adapters in lockstep.

---

## License

ISC
