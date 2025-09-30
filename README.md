Got it ✅
Here’s the complete **README.md** file you can copy–paste directly into your GitHub repo:

````markdown
# React Telemetry Lib

A **cross-platform telemetry library** for React and React Native.  
It provides a unified way to log analytics/telemetry events with consistent metadata (device info, network info, session data, etc.), and supports batching and flushing to a backend.

---

## ✨ Features
- Works in **React (Web)** and **React Native** with platform-specific shims.
- Captures **device info**, **network info**, **user/session IDs** automatically.
- Supports **batched event logging** with flush mechanism.
- Minimal dependencies, works even on older versions of React (>=16).
- TypeScript ready with generated `.d.ts` files.

---

## 📦 Installation

```bash
npm install react-telemetry-lib
# or
yarn add react-telemetry-lib
````

### Peer dependencies

Make sure you have these installed in your project:

```json
"peerDependencies": {
  "react": ">=16",
  "react-dom": ">=16",
  "react-native": ">=0.64",
  "@react-native-async-storage/async-storage": ">=1.21.0",
  "@react-native-community/netinfo": "^11.4.1",
  "react-native-device-info": "^12.0.0"
}
```

> Some dependencies (like `react-native-device-info`) are optional on Web.

---

## 🚀 Usage

### Web

```ts
import { Telemetry } from "react-telemetry-lib";

const telemetry = new Telemetry({ batchSize: 5 });

telemetry.log("app_start", { foo: "bar" });
telemetry.log("button_click", { id: "login-btn" });
```

### React Native

```ts
import { Telemetry } from "react-telemetry-lib";

const telemetry = new Telemetry({ batchSize: 10 });

telemetry.log("screen_open", { screen: "Home" });
telemetry.log("purchase", { productId: "sku123" });
```

---

## 🔧 API

### `Telemetry` class

```ts
const telemetry = new Telemetry(options);
```

---

## 📱 Using `TelemetryNative` (React Native)

The `TelemetryNative` class extends the core `Telemetry` but comes pre-wired with:
- Native **device info collection** (`react-native-device-info`)
- Native **network info collection** (`@react-native-community/netinfo`)
- Auto-batching + flushing to a backend endpoint

### Example

```ts
import { TelemetryNative } from "react-telemetry-lib";

export const telemetry = new TelemetryNative({
  endpoint: "https://edgetelemetry.ncgafrica.com/collector/telemetry",
  batchSize: 3,          // number of events before flush
  flushIntervalMs: 10000 // auto-flush interval (ms)
});

// optional: start some background monitoring
telemetry.log("AppStarted", { platform: "native" });

```
#### Options

* `batchSize?: number` – Number of events before automatic flush (default: `10`).
* `userId?: string` – Optional user identifier.
* `sessionId?: string` – Custom session ID (auto-generated if not provided).
* `upload?: (events: TelemetryEvent[]) => Promise<void>` –
  Optional function to handle event upload.

#### Methods

* `log(name: string, data?: Record<string, any>)`
  Logs an event with metadata (device info, network info, session info).
* `flush()`
  Immediately sends the queued events.
* `setUserId(userId: string)`
  Updates the active user ID.
* `setSessionId(sessionId: string)`
  Updates the session ID.

---

## Routes

 
---

## 🧭 Navigation Tracking

You can automatically log screen changes with **React Navigation** or **Expo Router**.

### Example

```tsx
import { useNavigationContainerRef } from "expo-router";
import { useEffect } from "react";
import { telemetry } from "../lib/telemetry";

export default function RootLayout() {
  const navigationRef = useNavigationContainerRef();

  useEffect(() => {
    telemetry.attachNavigation(navigationRef); // 👈 tracks screen changes
    telemetry.log("AppLoaded", { platform: "native" });

    return () => telemetry.shutdown();
  }, [navigationRef]);

  return (
    // ... your navigation setup
  );
}
````

### What it does

* Tracks every route change
* Sends events like:

```json
{
  "name": "NavigationScreenView",
  "data": {
    "screen.name": "Home",
    "previous.screen": "Login"
  }
}
```

That’s it — one line `telemetry.attachNavigation(navigationRef)` and you’re done ✅

---

## ⚡ Advanced Usage: Custom Upload

By default, `flush()` just empties the queue.
You can provide a custom **upload function** to send batched events to your server or analytics pipeline.

```ts
import { Telemetry } from "react-telemetry-lib";

const telemetry = new Telemetry({
  batchSize: 5,
  upload: async (events) => {
    await fetch("https://my-api.example.com/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
    });
  },
});

telemetry.log("user_login", { method: "email" });
telemetry.log("page_view", { page: "dashboard" });

// When batchSize is reached or manually:
await telemetry.flush();
```

This ensures **all events are enriched** with:

* `userId`
* `sessionId`
* `timestamp`
* `device info`
* `network info`

before being sent to your backend.

---

## 🔄 Data Flow

```text
Telemetry.log(event) → Queue → Flush (batchSize reached or manual) → Upload (custom or default)
```

---

## 🛠 Development

Build the library:

```bash
npm run build
```

Start in dev mode:

```bash
npm run dev
```

Clean dist folder:

```bash
npm run clean
```

---

## 🌐 Multi-platform Build

The package exports both **Web** and **Native** entry points:

* Web: `dist/index.web.js`
* Native: `dist/index.native.js`

Your bundler (Metro for RN, Webpack/Vite for Web) will automatically pick the correct one based on the platform.

---

## 📄 License

ISC

```

---

👉 Do you also want me to include a **Getting Started example repo link** (with CRA for web + Expo for RN) in the README, so developers can test integration quickly?
```
