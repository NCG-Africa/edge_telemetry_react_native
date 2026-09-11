# @nathanclaire/edge-telemetry-sdk

[![npm version](https://img.shields.io/npm/v/@nathanclaire/edge-telemetry-sdk.svg)](https://www.npmjs.com/package/@nathanclaire/edge-telemetry-sdk)
[![React Native](https://img.shields.io/badge/React%20Native-0.64%2B-61DAFB.svg?style=flat&logo=react)](https://reactnative.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-3178C6.svg?style=flat&logo=typescript)](https://www.typescriptlang.org/)

Real User Monitoring for **React Native** and **React Native Web**. Add it once and it reports
what your users actually experience — crashes, slow screens, failing requests, dead taps — to
your EdgeTelemetryProcessor collector.

You import from one package name. The bundler picks the native or the web build for you.

```typescript
import { createTelemetry } from "@nathanclaire/edge-telemetry-sdk";

const telemetry = createTelemetry({
  apiKey: "edge_xxxxxxxx",
  endpoint: "https://collector.example.com/telemetry",
});
```

That's the whole setup. Crash capture, HTTP interception, screen tracking, frame and memory
sampling and session management all start on their own — there is nothing else to wire up.

## Requirements

| | Minimum |
|---|---|
| React Native | 0.64 |
| React / React DOM | 17 |
| Platforms | iOS, Android, and any modern browser via React Native Web |
| TypeScript | Optional — types ship with the package |

---

## Contents

**Getting started**
- [Install](#install)
- [Quick start](#quick-start)
- [Verify it's working](#verify-its-working)
- [Configuration](#configuration)

**How-to guides**
- [Send a custom event](#send-a-custom-event)
- [Identify the signed-in user](#identify-the-signed-in-user)
- [Track screens](#track-screens)
- [Track taps](#track-taps)
- [Report handled errors](#report-handled-errors)
- [Make crash stacks readable](#make-crash-stacks-readable)
- [Strip PII before it leaves the device](#strip-pii-before-it-leaves-the-device)
- [Sample a percentage of sessions](#sample-a-percentage-of-sessions)
- [Connect your traces to your backend](#connect-your-traces-to-your-backend)

**Reference**
- [What the SDK captures](#what-the-sdk-captures)
- [API](#api)
- [The Context block](#the-context-block)
- [Wire format](#wire-format)
- [Identity and IDs](#identity-and-ids)
- [Delivery and reliability](#delivery-and-reliability)

**Help**
- [Troubleshooting](#troubleshooting)
- [Upgrading](#upgrading)
- [Development](#development)

---

## Install

```bash
npm install @nathanclaire/edge-telemetry-sdk
```

### React Native — one extra step

The native modules the SDK reads device and network state from ship as dependencies, so npm
installs them for you. On iOS, link them:

```bash
cd ios && pod install
```

| Module | What it provides | If it's missing |
|---|---|---|
| `@react-native-async-storage/async-storage` | Saves failed batches for replay | Telemetry is lost on a network outage instead of retried |
| `@react-native-community/netinfo` | `network.*` context, `network_change` events | No connectivity data |
| `react-native-device-info` | `device.*` detail, the `memory_usage` metric | Degrades gracefully — this one is an **optional** peer |

`react` and `react-dom` (>= 17) are required peers and will already be in your app.

### React Native Web

The web build uses `fetch`, `localStorage` and `navigator` only. Nothing to link, nothing to
configure.

---

## Quick start

Create the instance once, as early in your app's startup as you can, and export it.

```typescript
// telemetry.ts
import { createTelemetry } from "@nathanclaire/edge-telemetry-sdk";

export const telemetry = createTelemetry({
  apiKey: "edge_xxxxxxxx",                             // required, must start with "edge_"
  endpoint: "https://collector.example.com/telemetry", // your collector's POST URL
  buildId: process.env.GIT_SHA,                        // optional, makes crashes symbolicatable
});
```

```typescript
// App.tsx
import { telemetry } from "./telemetry";

await telemetry.log("checkout_started", { cart_value: 42 });
```

**Create it early.** Everything before `createTelemetry()` runs is invisible to the SDK — a crash
during startup, the first screen's load time, the requests your splash screen fires. The first
line of your entry file is the right place.

> **Every public method returns a Promise.** Each one waits on a lazily-built core, so `await`
> your calls — or at minimum attach a `.catch()`. They never throw at you; the SDK swallows its
> own failures rather than taking your app down with it.

---

## Verify it's working

Turn on debug logging, send one event, and force a flush:

```typescript
const telemetry = createTelemetry({
  apiKey: "edge_xxxxxxxx",
  endpoint: "https://collector.example.com/telemetry",
  debug: true,          // routes the SDK's internal diagnostics to the console
});

await telemetry.log("hello_world");
await telemetry.flush();   // don't wait for the 30-second timer
```

You should see the batch POST in your console and a `200` from the collector. If you don't, start
at [Troubleshooting](#troubleshooting).

**The SDK is silent by default.** With `debug` off — the default — it writes nothing to your
console, including when its own sends fail. That is deliberate: a monitoring tool should not be
the noisiest thing in your log. Turn it on while integrating, then turn it off.

---
## Configuration

Everything is passed to `createTelemetry()`. There are no runtime setters for the options marked
**constructor-only** — see the note below the table.

| Option | Type | Default | What it does |
|---|---|---|---|
| `apiKey` | `string` | — | **Required.** Must start with `edge_`. Sent as both `X-API-Key` and `Authorization: Bearer`. |
| `endpoint` | `string` | placeholder | Your collector's full POST URL. **Always set this** — the default resolves nowhere. |
| `batchSize` | `number` | `50` | Events per flush. |
| `flushIntervalMs` | `number` | `30000` | How often to flush. `<= 0` disables the timer. |
| `captureConsole` | `boolean` | `false` | Turns `console.error` into `app.error` and `console.warn` into a breadcrumb. |
| `debug` | `boolean` | `false` | Prints the SDK's internal diagnostics. Off means completely silent. |
| `buildId` | `string` | omitted | Your build's identifier, for [symbolicating crashes](#make-crash-stacks-readable). |
| `beforeSend` | `(event) => event \| null` | none | [Scrubbing hook](#strip-pii-before-it-leaves-the-device). Constructor-only. |
| `sessionSampleRate` | `number` | `1` | [Fraction of sessions to keep](#sample-a-percentage-of-sessions), `0`–`1`. Constructor-only. |
| `traceHostAllowlist` | `string[]` | `[]` (empty) | [Hosts allowed to receive `traceparent`](#connect-your-traces-to-your-backend). Constructor-only. |
| `store` | `Store` | platform default | Replaces `localStorage` / `AsyncStorage`. Mostly for tests. |
| `sender` | `Sender` | platform default | Replaces the HTTP transport. Mostly for tests. |

```typescript
const telemetry = createTelemetry({
  apiKey: "edge_xxxxxxxx",
  endpoint: "https://collector.example.com/telemetry",
  batchSize: 50,
  flushIntervalMs: 30_000,
  buildId: process.env.GIT_SHA,
  sessionSampleRate: 1,
  traceHostAllowlist: ["api.example.com"],
});
```

**Why some options are constructor-only.** `beforeSend`, `sessionSampleRate` and
`traceHostAllowlist` cannot be set after init, because the gap between the two is not empty: by
the time you called a setter, `session.started`, the launch trace root and your first HTTP
requests are already queued. A scrubber that misses the first events is not a scrubber.

### Two things to get right

**`apiKey` is validated immediately.** A key that doesn't start with `edge_` throws from
`createTelemetry()`, so a typo fails at startup instead of silently dropping data for a week. The
value may be an API key *or* an `edge_`-prefixed JWT; the collector accepts both. You never send a
tenant ID — the backend resolves your tenant from the key.

**`endpoint` is used verbatim.** The collector terminates `POST /telemetry`. If you leave it
unset, every send fails against a placeholder host.

---

## Send a custom event

```typescript
await telemetry.log("checkout_started", { cart_value: 42, currency: "KES" });
```

Your `data` is flattened into dot-notation attributes and must hold **primitive values** — string,
number, boolean. Objects are flattened; arrays and anything nested deeper than 8 levels are
JSON-stringified.

> **Names outside the allowlist still arrive.** Only [allowlisted event names](#what-the-sdk-captures)
> travel under their own name. Any other name — `checkout_started` above — is sent as
> `custom_event` with your name preserved in `attributes["event.name"]`. Nothing is dropped, so
> query custom events by `event.name`, not by `event_name`.

---

## Identify the signed-in user

```typescript
await telemetry.identify({
  userId: "u-42",
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+254700000000",
  customAttributes: { plan: "pro", org: "acme" },
});
```

`identify()` does two things: it sets `user.id` on every subsequent event, and it emits one
`user.profile.update` event carrying the profile.

> **Warning — if you are upgrading from v3, read this.** `setUserProfile()`, `setUserDetails()`,
> `updateUserProfile()`, `setUserName()` and `setUserContact()` now record state **only**. They no
> longer put anything on the wire. If your app used one of them and never called `identify()`,
> your profile data stopped arriving at the v4 upgrade. Add one `identify()` call.

**Why the change:** `user.name`, `user.email` and `user.phone` used to ride the Context block of
*every* event, so a 10,000-event session put 10,000 copies of an email address on the wire and at
rest, to populate a table that needs it once. They now ride `user.profile.update` and no other
event. Because the profile is held in memory, `identify()` re-fires on every launch and the table
stays current.

**Limits.** `name` and `email` truncate at 255 characters, `phone` at **50** (the column is
`VARCHAR(50)`, and an over-long value loses the whole profile behind a `200`).
`customAttributes` is capped at 64 keys, 64-character keys and 255-character values;
non-primitive values are JSON-stringified then truncated. Anything dropped is counted in
`user.custom_dropped` and warned about once, in development. A bad payload is never a throw.

**`user.id` is yours.** The SDK never mints one. Omit `userId` and your traffic stays anonymous —
still fully joinable on `device.id`, just not attributed to a person.

---

## Track screens

The SDK opens a **view** at startup and closes it at each of four boundaries: a route change,
backgrounding, a session rotation, and process death. Each closed view emits one `view` event
with its name, dwell time, request count and load time.

### React Navigation (recommended, both platforms)

```tsx
import { NavigationContainer, useNavigationContainerRef } from "@react-navigation/native";
import { telemetry } from "./telemetry";

export default function App() {
  const navRef = useNavigationContainerRef();

  return (
    <NavigationContainer
      ref={navRef}
      onReady={() => { telemetry.attachNavigation(navRef); }}
    >
      {/* your screens */}
    </NavigationContainer>
  );
}
```

One call covers native **and** web — `getCurrentRoute()` is a navigation-tree API, not a native
one.

### Naming screens manually

```typescript
await telemetry.screenStart("Checkout");   // native only
await telemetry.screenEnd("Checkout");     // native only
```

> **Warning — don't mix `screenStart()` with `attachNavigation()`.** Screen names have ranks:
> an explicit name outranks a route name, which outranks a URL. A lower-ranked name never
> overwrites a higher-ranked one — so a single `screenStart()` call pins the view to that name
> and later route changes stop opening new views. Pick one approach per screen.

### Reading the results

`view` events carry `view.loading_time`, measured as **network settle**: the point where the
screen's in-flight requests go quiet for a second. It is deliberately `null`, never `0`, for a
screen that fetched nothing — a `0` would make your p75 track the cache-hit rate, so a backend
caching win would show up as a frontend regression.

`view.loading_time_outcome` always ships and tells the nulls apart:

| Outcome | Meaning |
|---|---|
| `settled` | Requests finished. `view.loading_time` has a number. |
| `no_activity` | The screen started no requests. Null. |
| `capped` | Still loading after 30 seconds. Null — **not** the cap, so 30s and 90s stay distinguishable. |
| `abandoned` | The user left while it was still loading. Null. |

Query **p75 where `outcome = 'settled'`**, alongside **% `capped`**. A plain
`AVG(loading_time)` averages four different populations.

> One screen visit can produce several `view` rows — backgrounding and returning splits it. Sum by
> `view.name`.

---
## Track taps

### Web — automatic

Every click emits a `ui.interaction` event. No wiring: the SDK attaches one capture-phase
listener to `document`.

**Names are read only from elements that are actionable by role** — `<button>`, `<a href>`,
`<input type="submit|button|reset">`, `<summary>`, `<option>`, or an explicit
`role="button|link|tab|checkbox|radio|switch|menuitem|option"`. That gate is what stops a
clickable `<div>` full of customer data from being auto-named. On React Native Web, a `Pressable`
lands on a role-bearing element automatically.

To name anything yourself — including a role-less element — use `data-edge-action-name`:

```html
<div data-edge-action-name="Checkout — Step 2 of 3">…</div>
```

It wins over everything else and ships **exactly as written**, uncapped and unnormalized, because
you should be able to predict the value you just set. Below it the SDK tries `data-testid`,
`aria-label`, `title`, then `textContent` — each lowercased, with non-alphanumerics folded to `_`
and capped at 64 characters, so `"Add to cart!"` becomes `add_to_cart`.

When nothing matched, `ui.target` tells you why:

| The click landed on | `ui.target` | Read it as |
|---|---|---|
| A role-bearing element, a name was found | the name | — |
| A role-bearing element, nothing readable | `unnamed` | An instrumentation gap. Add `data-edge-action-name`. |
| A role-less element with `cursor: pointer` | `unnamed` | Same gap. |
| A role-less element, default cursor | `surface` | Someone tapped padding. Nothing to fix. |

Two frustration signals ride along automatically: **`ui.rage`** (3+ clicks within a second on the
same element) and **`ui.dead`** (no DOM change, no request and no navigation within a second of an
actionable click).

> **Warning — the role gate is not a privacy control.** `<button>Delete John Kamau</button>` still
> ships that text as the event name. Use [`beforeSend`](#strip-pii-before-it-leaves-the-device)
> to scrub it. There is deliberately no per-element masking attribute.

### Native — name the taps you care about

```tsx
<Pressable
  onPress={() => {
    telemetry.trackTap("checkout");
    navigation.navigate("Cart");
  }}
/>
```

Native taps are explicit-only. React Native gives a press handler a numeric node tag with no
public API to resolve it, so a root-level listener genuinely cannot tell a button from padding —
anything auto-derived would be wrong, or a PII leak. Name the controls that matter.

The name ships uncapped and unnormalized, exactly as you wrote it.

> **Your interaction coverage equals your instrumentation coverage.** An uninstrumented screen
> looks identical to an unused one. `ui.rage` on native is gated to named taps too, so a low rage
> count means *few named taps*, not happy users. And `ui.dead` never appears on native at all —
> there is no DOM, so there is no mutation signal — so any dead-click rate must filter to web.

**The tap's identity is captured at the tap, not at send.** A tap that navigates is still
attributed to the screen it happened on, not the one it opened.

---

## Report handled errors

Unhandled errors are captured for you. For the ones you catch, call `captureError()`:

```typescript
try {
  await pay();
} catch (err) {
  await telemetry.captureError(err, { "checkout.step": "pay" });
}
```

It takes `unknown` on purpose — real `catch` blocks receive strings and axios rejection objects,
and you shouldn't have to prove to TypeScript that it's an `Error` first.

### Two event names, and why it matters

| | `app.crash` | `app.error` |
|---|---|---|
| Means | Unhandled | Handled |
| Comes from | `ErrorUtils`, `window.onerror`, unhandled rejections | `captureError()`, opted-in `console.error` |
| Carries breadcrumbs | Yes — the last 20 actions | No |

The split exists for one query: crash-free rate is
`COUNT(event_name = 'app.crash') / sessions`, with no `WHERE` clause anyone can forget.

> **`app.crash` is SDK-owned.** `log("app.crash", …)` is routed to `app.error` rather than
> manufacturing a crash row. A reported error is data — it just isn't a crash.

> **Warning — `error.fatal` is a trap on web.** Nothing is fatal in a browser: `window.onerror`
> fires and the page keeps running, so `error.fatal` is native-only. A cross-platform
> `1 − COUNT(fatal = true) / sessions` scores web at 100% forever. Use the unfiltered
> `COUNT(app.crash)`, or exclude web.

### Capturing console output

```typescript
createTelemetry({ apiKey: "edge_xxxxxxxx", endpoint: "…", captureConsole: true });
```

Off by default. With it on, `console.error` becomes an `app.error` and `console.warn` becomes a
breadcrumb. It defaults off because React's own development-mode warnings were the single largest
contributor to v3 crash counts, which made "is this release crashing more?" unanswerable.

---

## Make crash stacks readable

React Native ships every crash stack minified, so each frame reads as a single letter. Two lines
fix that, and the SDK writes neither on your behalf.

```typescript
// 1. In your entry file, before anything else runs:
Error.stackTraceLimit = 50;

// 2. In your telemetry config:
const telemetry = createTelemetry({
  apiKey: "edge_xxxxxxxx",
  endpoint: "https://collector.example.com/telemetry",
  buildId: process.env.GIT_SHA,     // ships as app.build_id
});
```

**`Error.stackTraceLimit`** defaults to **10 frames** — well short of what the SDK can carry, and
ten frames of a rejected promise can be entirely library internals. The SDK never assigns it,
because raising it globally would make every `new Error()` in *your* app more expensive,
invisibly. It warns once in development and leaves the line to you.

**`buildId`** is the symbolication join key. Use a git SHA or a CI run number. Crashes resolve
against `(app, device.platform, app.build_id)` — three parts, because one commit produces
different Metro output for iOS and Android, and a one-part key would resolve an Android crash
against the iOS source map and give you frames that are plausible and wrong.

> **Warning — never derive `buildId` from your app version.** `${version}-${buildNumber}` is
> correct for most apps, which is exactly what makes it dangerous: under Expo Updates or CodePush
> the native binary is unchanged, so the derived key fetches the **wrong** source map and resolves
> to plausible-wrong line numbers, with nothing on the row marking them untrustworthy. The SDK has
> no OTA awareness and will not guess. Leave `buildId` unset and crashes stay unsymbolicated —
> which is at least honest.

Stack traces travel raw and byte-for-byte so `metro-symbolicate` can consume them. Over the
2000-character cap the tail is dropped on a frame boundary and marked `… [truncated]`.

---
## Strip PII before it leaves the device

`beforeSend` runs on every event and metric, synchronously, **at enqueue** — before anything can
reach the network *or* the offline store. Return the event to keep it, or `null` to drop it.

```typescript
import { createTelemetry, type BeforeSend } from "@nathanclaire/edge-telemetry-sdk";

const scrub: BeforeSend = (event) => {
  const attrs = event.attributes;
  if (!attrs) return event;

  // Drop a key outright
  delete attrs["ui.target"];

  // Or rewrite one
  if (typeof attrs["user.email"] === "string") {
    attrs["user.email"] = hash(attrs["user.email"]);
  }

  // Or drop the whole event
  if (event.eventName === "custom_event" && attrs["event.name"] === "internal_debug") {
    return null;
  }

  return event;
};

const telemetry = createTelemetry({ apiKey: "edge_xxxxxxxx", endpoint: "…", beforeSend: scrub });
```

**It runs at enqueue, not at flush,** because a failed send persists the batch to disk — and on
native that disk outlives the process. A flush-time hook would let unscrubbed PII land there
first. **It is synchronous** because crashes flush during teardown, and a Promise-returning hook
would put your `await` in a dying app's path.

**It covers metrics too.** `vital.target` is a raw CSS selector and the least sanitized value the
SDK sends.

### What you can and cannot change

Your hook gets a **copy**. Three tiers are re-stamped from the original after it returns:

| Tier | Keys | What happens |
|---|---|---|
| **A — immutable** | `type`, `eventName`/`metricName`, `timestamp`, `session.*`, `event.sequence`, everything under `sdk.` and `app.`, `device.platform`, `trace.id`, `span.id`, `parent.span.id`, `rum.action.id`, `view.id` | Restored — covers deletion *and* forgery |
| **B — rewritable, not deletable** | `device.id` | Hash it if you like; delete it and the collector rejects the batch |
| **C — yours** | Everything else: `user.*`, `http.*`, `error.*`, `ui.target`, `vital.target`, your own `log()` data | Untouched. This is where the PII lives. |

The tiers are enforced by re-stamping, **never by throwing**. The realistic hook is a `delete`
loop and the realistic bug is over-deletion — an over-broad hook must not be able to get your
whole feed silently discarded behind a `200`.

**A hook that throws fails closed:** the event is dropped, never sent in its original form,
because a bug in a scrubber must not ship the exact field the scrubber existed to remove. Only an
explicit `null` counts as a deliberate drop. The two outcomes are counted separately on the wire
— `sdk.hook_dropped` and `sdk.hook_failed` — because "my volume is down 40%" needs to distinguish
a working scrubber from a broken one.

---

## Sample a percentage of sessions

```typescript
createTelemetry({ apiKey: "edge_xxxxxxxx", endpoint: "…", sessionSampleRate: 0.1 });
```

The dice are rolled **once per session**, persisted with the session record and re-rolled when
the session rotates — never per event, which would desynchronise the per-view counters. A
sampled-out session sends **nothing at all**.

> **Warning — crashes are not exempt.** Sampling out a session drops its crashes too. It has to:
> keeping 100% of crashes over 10% of sessions makes the unfiltered crash-free query read ten
> times too healthy, with no `WHERE` clause available to repair it.

Every row carries `session.sample_rate`, so extrapolating back up is arithmetic. A rate outside
`0`–`1`, or a `NaN`, warns and falls back to `1` — `Math.random() < NaN` is always false and
would silently mute your entire deployment.

---

## Connect your traces to your backend

The SDK can attach a W3C `traceparent` header to your API calls, so a slow screen in your RUM
data links to the exact backend trace that caused it.

**This is off by default.** The allowlist starts empty, so upgrading can never break your network
calls on day one. Opt hosts in explicitly:

```typescript
createTelemetry({
  apiKey: "edge_xxxxxxxx",
  endpoint: "https://collector.example.com/telemetry",
  traceHostAllowlist: ["api.example.com", "checkout.example.com"],
});
```

> **Warning — do this first.** Add `traceparent` to `Access-Control-Allow-Headers` on every host
> you list, *before* you list it. Missing that header is what *"our app broke when we turned on
> tracing"* actually means. Adding a header also turns previously-simple cross-origin GETs into
> preflighted ones, so set `Access-Control-Max-Age` while you're there.

### The rules, in full

- **Bare hosts, exact match.** `api.example.com`, not `https://api.example.com/v2` and not
  `*.example.com`. Listing a host is your assertion that *that host's* CORS allows the header,
  and nobody can make that assertion over a wildcard.
- **Ports are ignored** when matching. Note that `http.host` on the wire *keeps* the port — the
  two are deliberately different, so don't join on them.
- **`traceparent` is the only header the SDK writes, and the only one it reads.** No `b3`, no
  `tracestate`, ever. That is a sentence you should be able to state in a security review.
- **The SDK never strips or rewrites a header it didn't add.** Set your own `traceparent` and it
  adopts yours and steps aside.
- **No retry without the header.** A rejected preflight and a dead server are the same
  `TypeError`, so retrying would double-send a non-idempotent POST. A tracing feature must not be
  able to double-charge a card.
- **A malformed allowlist entry throws in development and is dropped in production.** A RUM SDK
  crashing a shipped banking app over a config typo is the one failure worse than no tracing.

### Debugging a missing join

Every request stamps `traceparent.outcome`, so "the trace isn't joining" is a query rather than a
mystery:

| Value | What happened |
|---|---|
| *(absent)* | Not traced — you have no allowlist |
| `skipped_off_allowlist` | You have an allowlist and this host isn't on it |
| `skipped_no_cors` | The request's `mode` ruled it out (fetch only) |
| `skipped_consumer_set` | You set a `traceparent` and it couldn't be parsed |
| `adopted` | You set a valid one; the SDK used yours |
| `injected_attributed` | Injected and joined to a live user action — the healthy case |
| `injected_expired` | Injected, but the action it belonged to had aged out |
| `injected_unattributed` | Injected with no user action in flight at all |

Every skip still stamps local IDs even though no header goes out. That is what makes *"the row is
here but the backend join is missing"* mean **the header was stripped in transit** rather than
something ambiguous.

> An unsampled session injects no header at all — not a `flags=00` one.

---
## What the SDK captures

All of this starts in the constructor. You don't call anything to enable it.

### Events

| Event | Fires when | Platform |
|---|---|---|
| `app.start` | Once per process, at init | Both |
| `session.started` / `session.finalized` | Session begins / rotates | Both |
| `app_lifecycle` | Foreground ⇄ background | Both |
| `view` | A screen visit ends (route change, background, session rotation) | Both |
| `http.request` | Every `fetch` / `XHR` completes | Both |
| `app.crash` | Unhandled error or promise rejection | Both |
| `app.error` | `captureError()`, or an opted-in `console.error` | Both |
| `ui.interaction` | Every click (web) / every `trackTap()` (native) | Both |
| `network_change` | Connectivity type changes | Both |
| `user.profile.update` | `identify()` | Both |
| `navigation` | Route change or `screenStart()` | Both *(deprecated)* |
| `screen.duration` | `screenEnd()` | Native *(deprecated)* |
| `custom_event` | Any `log()` name not in this table | Both |

### Metrics

| Metric | What it measures | Platform |
|---|---|---|
| `frame_render_time` | p95 frame time per window; closes every 10s **or** at a screen change | Both |
| `memory_usage` | Resident memory (RSS) in MB, sampled every 30s | **Native only** |
| `LCP` `FCP` `TTFB` | Core Web Vitals, once per page load | **Web only** |
| `CLS` `INP` | Running values, sent when the tab is hidden | **Web only** |

Metrics carry `metric.unit` — `ms`, `MB`, or `score` for CLS.

> **Web-only metrics are web-only on purpose.** Native emits no Core Web Vitals, and web emits no
> `memory_usage` — `performance.memory` is Chromium-only, so the metric's mere presence was a
> browser-detection signal wearing a memory label.

> **Warning — Core Web Vitals are page-load-scoped, not screen-scoped.** `LCP`, `FCP` and `TTFB`
> physically cannot recur on a soft navigation, so `view.id` on a vital row is always the
> **initial** view's. `GROUP BY view.name` over vitals reads as *"by entry point"* — a useful
> dashboard, as long as you label it that way.

### Retired names

`page_load`, `resource_timing`, `long_task` and `user.interaction` were removed in v4. They are
unreachable — `log("page_load")` now arrives as `custom_event`. Their jobs are covered by `view`,
`view.loading_time`, the Core Web Vitals and `frame_render_time`.

---

## API

Every method returns a Promise.

### Core — both platforms

```typescript
log(event: string, data?: Record<string, any>): Promise<void>
captureError(error: unknown, context?: Record<string, any>): Promise<void>
flush(): Promise<void>            // send the queue now
shutdown(): Promise<void>         // stop timers and do a final flush
attachNavigation(navigationRef: any): Promise<void>
trackErrors(options?: { captureConsole?: boolean }): Promise<void>
getDeviceInfo(): Promise<DeviceInfo>
getNetworkInfo(): Promise<NetworkInfo>
```

### Identity — both platforms

```typescript
identify(profile: {
  userId?: string;
  name?: string;
  email?: string;
  phone?: string;
  avatar?: string;
  customAttributes?: Record<string, any>;
}): Promise<void>                         // the only method that puts a profile on the wire

setUserId(id: string): Promise<void>      // "" clears it — no empty string is ever sent
getUserProfile(): Promise<UserProfile | undefined>
clearUserProfile(): Promise<void>         // clears user.id; leaves device.id alone

// State-only. These record a profile but emit nothing — call identify() to send it.
setUserProfile(profile): Promise<void>
setUserDetails(details): Promise<void>
updateUserProfile(updates): Promise<void>
setUserName(fullName: string, firstName?: string, lastName?: string): Promise<void>
setUserContact(email?: string, phone?: string): Promise<void>
```

> `fullName`, `firstName`, `lastName`, `avatar`, `createdAt` and `updatedAt` are `@deprecated` and
> go away in v5. `fullName` still works — it's what `user.name` is built from. The other five
> reach no wire key at all.

### Native only

```typescript
trackTap(name: string): Promise<void>        // → ui.interaction. Never rejects.
trackMemoryUsage(): Promise<void>            // auto-started
screenStart(name: string): Promise<void>     // → navigation      (deprecated feed)
screenEnd(name: string): Promise<void>       // → screen.duration (deprecated feed)
trackRoute(from: string, to: string): Promise<void>   //            (deprecated feed)
```

Prefer `attachNavigation()` over `screenStart` / `screenEnd` / `trackRoute` — those three feed
`navigation` and `screen.duration`, both superseded by the `view` event.

### Web only

```typescript
trackInteractions(): Promise<void>     // auto-started
autoTrackNavigation(): Promise<void>   // auto-started
```

`trackFrameDrops()`, `trackNetworkRequests()` and `attachAppLifecycle()` exist on both classes and
are auto-started too. Core Web Vitals capture is intentionally private — there is nothing to
configure, and a vital that only fires when someone remembers to call a method is a vital nobody
has.

### Exports

```typescript
import {
  createTelemetry,          // the factory — start here
  memoryStore,              // an in-memory Store, for tests
  type TelemetryOpts,
  type BeforeSend,
  type Store, type SyncStore, type AsyncStore, type StoreRead, type StoreWrite,
  type MemoryStoreOpts,
} from "@nathanclaire/edge-telemetry-sdk";
```

`TelemetryWeb` and `TelemetryNative` are also exported, but **use `createTelemetry()`** — it is
the only path that validates your `apiKey` and your trace allowlist. Constructing a class
directly skips both checks.

> `TelemetryEvent`, `DeviceInfo`, `NetworkInfo` and `UserProfile` are documented in this README as
> wire and return shapes, but are **not currently exported as types**. For a `beforeSend` hook,
> annotate with the exported `BeforeSend` and let the event type infer.

---

## The Context block

Every event and metric carries a flat, dot-namespaced set of attributes describing *who, where and
when*. It means each row is self-describing — you never join against a separate device or session
event.

```
session.id  session.start_time  session.sequence  session.sample_rate  event.sequence
user.id                         device.id         device.id_ephemeral
view.id     view.name
sdk.platform  sdk.version  sdk.events_dropped  sdk.drop_reason  sdk.hook_dropped  sdk.hook_failed
app.name  app.version  app.build_number  app.package_name  app.build_id
device.platform  device.platform_version  device.model  device.manufacturer  device.brand
device.screen_density  device.screen_width_px  device.screen_height_px  device.orientation
device.cpu_abi  device.low_ram                            ← native only
network.type  network.is_connected
```

It is **frozen at 39 keys**. A key the SDK has nothing for is **omitted entirely** — never sent as
`null` or `undefined`. Absence means "we had nothing", consistently, everywhere.

Your `log()` data is flattened on top, so it can override any `app.*`, `device.*` or `network.*`
key — but **not** the identity keys, which are stamped afterwards.

**Network and device state are read at log time**, not at init: a request that failed when the
Wi-Fi dropped is better described by the network at the moment it completed.

---

## Wire format

```http
POST /telemetry HTTP/1.1
Content-Type: application/json
X-API-Key: edge_xxxxxxxx
Authorization: Bearer edge_xxxxxxxx
```

```json
{
  "type": "telemetry_batch",
  "timestamp": "2026-07-02T06:00:00.000Z",
  "batch_size": 3,
  "events": [ /* … */ ]
}
```

Each entry:

```typescript
type TelemetryEvent = {
  type: "event" | "metric";
  eventName?: string;                // events
  metricName?: string;               // metrics
  value?: number;                    // metrics
  timestamp: string;                 // ISO 8601, never a millisecond epoch
  attributes?: Record<string, any>;  // flat, dot-namespaced, includes the Context block
};
```

**Both credential headers are always sent, with the same value.** A shared collector reads
`X-API-Key`; a segmented one running `AUTH_MODE=jwt` reads `Authorization`. One build serves
both, so nothing has to sniff the credential's shape.

---

## Identity and IDs

```
device_{ms}_{16 hex}_{ios|android|web}
session_{ms}_{16 hex}_{ios|android|web}
```

Entropy comes from `crypto.getRandomValues`. There is no `Math.random()` fallback — a weak ID
that persists forever is worse than refusing to mint one.

**`device.id` is the SDK's. `user.id` is yours.**

| | `device.id` | `user.id` |
|---|---|---|
| Minted by | The SDK, once | You, via `setUserId()` / `identify({ userId })` |
| Rotates | **Never** — not on `identify()`, not on logout | Whenever you set it |
| Present | Always | Only after you set one |
| Answers | Anonymous reach | Known-user reach |

Because `device.id` survives the login transition, `GROUP BY device.id` stitches a user's
anonymous and signed-in sessions together.

**When storage is unavailable** — incognito, a partitioned iframe, Safari ITP eviction, a full
disk — `device.id` lives for one process only and the row carries `device.id_ephemeral: true`.
Exclude that population from device counts; without the flag, a set of users who never return
inflates `COUNT(DISTINCT device.id)` and reads as growth.

### Sessions

A session ends after **30 minutes of inactivity** or **4 hours** total, whichever comes first.

The session record is persisted, so **process death, a tab close, a hard reload and a bfcache
restore all resume the same session** if the gap is inside the idle window. A resumed session
deliberately does *not* re-emit `session.started` — otherwise `COUNT(session.started)` would stop
equalling your session count.

---

## Delivery and reliability

| | Behaviour |
|---|---|
| **Batching** | Flushes at `batchSize` events or every `flushIntervalMs`, whichever comes first |
| **Retry** | 3 attempts — exponential backoff with jitter on native, linear on web |
| **Offline queue** | After the last retry, the batch is written to `telemetry_failed_events` and replayed on the next init |
| **Caps** | 500 events in memory, 500 events / 1 MB on disk. Both drop oldest first, and **`app.crash` is evicted last** |
| **Crashes** | Don't wait for the batch — the queue is persisted and one batch sent immediately, crash first |
| **Page unload** | The web sender uses `fetch({ keepalive: true })`, so in-flight batches outlive the document |

Anything dropped is reported on the wire as `sdk.events_dropped` and `sdk.drop_reason`, so loss is
visible rather than silent.

**Crashes are evicted last on purpose.** Evicting them first would make your crash-free rate look
*better* the worse the user's network was.

> **Note — `flush()` sends one batch per call.** It does not loop. A large backlog still drains
> one batch per interval.

---
## Troubleshooting

Start by setting `debug: true` and calling `await telemetry.flush()`. Almost everything below
shows up in that output.

### Nothing arrives at all

| Check | How |
|---|---|
| Is the endpoint right? | The collector terminates **`POST /telemetry`**. Leave `endpoint` unset and every send goes to a placeholder host that resolves nowhere. |
| Did `createTelemetry()` throw? | An `apiKey` not starting with `edge_` throws synchronously, at startup. |
| Is the session sampled out? | With `sessionSampleRate < 1`, a sampled-out session sends **nothing**, crashes included. |
| Is `beforeSend` eating events? | A hook that throws drops the event. Check `sdk.hook_failed` on the rows that do arrive. |
| Did you flush? | Without `flush()` the first batch waits for 50 events or 30 seconds. |

### Events arrive but a dashboard is empty

Your event name is probably being rewritten. Only [allowlisted names](#what-the-sdk-captures)
travel as themselves; everything else arrives as `custom_event` with your name in
`attributes["event.name"]`. Query on `event.name` for custom events.

If the name *is* allowlisted and the column is still empty, the backend may not have the name
enabled on its own ingest allowlist yet — unlisted names are dropped on arrival. That is a
backend configuration question, not an SDK one.

### Common surprises

| Symptom | Cause |
|---|---|
| Profile data stopped arriving after upgrading to v4 | `setUserProfile()` and friends are state-only now. Call `identify()`. |
| "Our app broke when we enabled tracing" | The host is missing `Access-Control-Allow-Headers: traceparent`. |
| Crash stacks are single letters | Set `buildId` and `Error.stackTraceLimit = 50`. See [Make crash stacks readable](#make-crash-stacks-readable). |
| `device.id` changes every launch | Storage is unavailable. Look for `device.id_ephemeral: true` on the rows. |
| No `http.request` events from axios | Should work — axios rides XHR, and XHR is the SDK's interception point on both builds. If it doesn't, check that the request isn't going to your collector's own endpoint, which is excluded by design. |
| No Core Web Vitals on native | Correct — they're web-only, by design. |
| No `memory_usage` on web | Correct — it's native-only, by design. |
| No dead-click data on native | Correct — no DOM, so no mutation signal. Filter dead-click rates to web. |
| `screen.duration` never fires | You're using `attachNavigation()`. Use the `view` event instead — it supersedes both deprecated feeds. |
| A screen's name is stuck on an old value | You mixed `screenStart()` with `attachNavigation()`. An explicit name outranks a route name and pins the view. |
| `view.loading_time` is null | Read `view.loading_time_outcome` — it tells you which of the three reasons applies. |

### Requests the SDK can't see

Interception covers JavaScript `fetch` and `XHR`. It does **not** see `rn-fetch-blob`, React
Native Firebase, native Apollo links, `expo-file-system`, `Image` loading or WebSockets. A screen
whose real wait is one of those reports `no_activity`.

---

## Upgrading

### To v4

**Read [`docs/migration-v4.md`](docs/migration-v4.md) before you deploy.** It ships inside the npm
package, not just in the repo.

Of the twenty behavioural changes between 3.1.0 and v4, **exactly one breaks a build** — the
`getDeviceInfo()` / `getNetworkInfo()` return shapes. The other nineteen are silent: no compile
error, no runtime error, no log line. They surface as a saved filter returning zero rows, or a
chart stepping at the release boundary. That is precisely why the note exists.

**The one action item most apps have:** if you call `setUserProfile()`, `setUserDetails()`,
`updateUserProfile()`, `setUserName()` or `setUserContact()` and never call `identify()`, your
profile data no longer reaches the wire. Add one `identify()` call.

The migration note also lists **the columns React Native will never write** — ANR, hangs,
battery, `app.exit`, native crashes — so nobody builds a panel that stays empty forever.

### To v3

v3 was a single clean break onto the EdgeRum wire contract: `apiKey` became required, the POST
body became the `telemetry_batch` envelope, timestamps became ISO-8601, device and network data
moved onto every event as the Context block, and several event names changed. Full list in
[CHANGELOG.md](./CHANGELOG.md).

---

## Development

```bash
npm install
npm run build      # vite build → dist/ (web + native entries, ESM + CJS)
npm run dev        # vite in watch mode
npm test           # vitest run
npm run typecheck  # tsc --noEmit
npm run clean      # remove dist/
```

`prepare` runs the build, so installing this as a git dependency builds it automatically. `dist/`
and `*.tgz` are git-ignored.

**Platform code is split by filename**, not by runtime branching: `*.native.ts` and `*.web.ts`,
with the bundler choosing. Shared logic lives in a plain `.ts` and is tested once, which is how
the two builds stay in lockstep. When you add a capability, add both halves.

> One test (`src/vitals.native.test.ts`) reads `dist/` to prove the web-vitals dependency
> contributes zero bytes to the native bundle. It is red after `npm run clean` until the next
> build. That's deliberate — a source-graph proxy would pass a bundler change that a real chunk
> graph catches.

Architecture, conventions and the reasoning behind the design decisions live in
[`CLAUDE.md`](./CLAUDE.md). The wire contract — every key, its type and its null discipline — is
[`docs/backend-wire-contract.md`](./docs/backend-wire-contract.md), and it outranks everything
else where they disagree.

---

## License

MIT
