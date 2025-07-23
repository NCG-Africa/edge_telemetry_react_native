# 📡 EdgeTelemetry SDK (React Native)

**EdgeTelemetry** is a lightweight, open-source React Native SDK for collecting mobile app telemetry and exporting it to your own backend in JSON format — with full control and no vendor lock-in.

---

## 🎯 Project Goal

> Build a developer-friendly SDK that automatically collects app telemetry such as:
> - Crashes
> - ANRs
> - Navigation events
> - Network requests
> - Custom events
> 
> And exports all telemetry data to a custom backend endpoint in JSON format, with minimal setup.

---

## ✅ What We’ve Achieved So Far

- [x] Created project using `create-react-native-library`
- [x] Established clean and simple architecture based on Clean Architecture principles
- [x] Installed Embrace SDK (used internally for telemetry collection)
- [x] Defined project structure for maintainability
- [x] Created `EdgeTelemetryConfig` with `appName`, `exportUrl`, and `debug` options
- [x] Defined `TelemetryClient` interface to enforce a telemetry contract
- [x] Implemented `EmbraceClient` using the Embrace SDK v6.1.0
- [x] Created `EdgeTelemetry` coordinator with an `init()` method
- [x] Exported the SDK's public API via `index.ts`

---

## 🚧 What's Coming Next

- [ ] Start and verify Embrace SDK telemetry flow
- [ ] Enable auto-instrumentation (crash/ANR, screen, network)
- [ ] Create `JsonExporter` to send data to `exportUrl`
- [ ] Add public `trackEvent()` method
- [ ] Route telemetry events to your backend in JSON format
- [ ] Add `debug` logging and extensible configuration support

---

## 🛠️ SDK Implementation Plan

A lightweight React Native SDK that auto-collects telemetry and sends it to a custom backend.

### ✅ Phase 1: Foundation Setup

| Step | Task | Output |
|------|------|--------|
| 1️⃣ | Define `EdgeTelemetryConfig` type | `EdgeTelemetryConfig.ts` with `appName`, `exportUrl`, `debug` |
| 2️⃣ | Define `TelemetryClient` interface | Abstract contract for telemetry actions |
| 3️⃣ | Create `EmbraceClient` | Implements `TelemetryClient` using Embrace SDK |
| 4️⃣ | Create `EdgeTelemetry.ts` | `init(config)` sets up `EmbraceClient` and stores config |
| 5️⃣ | Export public API | `index.ts` re-exports `EdgeTelemetry` class |

---

### 🔁 Phase 2: Default Auto-Instrumentation (Triggered by `init()`)

| Step | Task | What Happens |
|------|------|--------------|
| 6️⃣ | Start Embrace SDK | `Embrace.start()` called internally |
| 7️⃣ | Set global config (app name, export URL) | Passed to exporter + logger |
| 8️⃣ | Enable crash & ANR monitoring | Leverage Embrace built-in features |
| 9️⃣ | Enable network monitoring | Use Embrace or instrument `fetch`/`Axios` manually |
| 🔟 | Enable screen tracking | Use React Navigation listeners or expo-router hooks |

---

### 📤 Phase 3: Export Telemetry to Custom Backend

| Step | Task | What It Does |
|------|------|--------------|
| 1️⃣1️⃣ | Create `JsonExporter` | Sends events/spans as JSON to `config.exportUrl` |
| 1️⃣2️⃣ | Add `trackEvent()` API | Track custom spans or events |
| 1️⃣3️⃣ | Wire `JsonExporter` to auto-send | Hook into span creation or OTel tracer if exposed |

---

### 🧩 Phase 4: Flexibility and Enhancements

| Step | Task | Purpose |
|------|------|---------|
| 1️⃣4️⃣ | Add `debug` logging | Controlled via `config.debug` |
| 1️⃣5️⃣ | Add optional config flags (later) | Allow turning off auto features if needed |
| 1️⃣6️⃣ | Add public types | Export `EdgeTelemetryConfig` for SDK users |
| 1️⃣7️⃣ | Update README.md | Document SDK usage

---
