
# React Telemetry Library

[![License](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![npm version](https://img.shields.io/npm/v/react-telemetry-lib.svg)](https://www.npmjs.com/package/react-telemetry-lib)
[![React](https://img.shields.io/badge/React-17%2B-61DAFB.svg?style=flat&logo=react)](https://reactjs.org/)
[![React Native](https://img.shields.io/badge/React%20Native-0.64%2B-61DAFB.svg?style=flat&logo=react)](https://reactnative.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-3178C6.svg?style=flat&logo=typescript)](https://www.typescriptlang.org/)
[![Bundle Size](https://img.shields.io/badge/Bundle%20Size-~50KB-orange.svg)]()
[![Memory](https://img.shields.io/badge/Memory-<2MB-green.svg)]()
[![Performance](https://img.shields.io/badge/Performance-Optimized-brightgreen.svg)]()

A comprehensive, production-ready cross-platform telemetry library for React and React Native applications. Built with modern JavaScript/TypeScript practices and optimized for performance, reliability, and developer experience across web and mobile platforms.

## 🚀 Features

### Core Telemetry
- **📊 Performance Monitoring**: Frame drop detection, memory tracking, and app performance metrics
- **🔄 Session Management**: Automatic session tracking with detailed analytics
- **📱 Screen Analytics**: Route and screen transition monitoring with timing data
- **🎯 Custom Events**: Track custom business events and user interactions
- **💥 Crash Reporting**: Comprehensive error detection and reporting with stack traces
- **🧠 Memory Intelligence**: Enhanced memory tracking with detailed insights
- **👤 User Profile Management**: Complete user profile system with automatic event enrichment

### Advanced Capabilities
- **🌐 Network Resilience**: Robust HTTP client with exponential backoff retry logic
- **💾 Offline Storage**: Persistent data storage with automatic sync when online
- **🔄 Batch Processing**: Efficient data batching to minimize network overhead
- **🧭 Navigation Support**: Native support for React Navigation and Expo Router
- **🔒 Privacy-First**: Automatic user ID generation with persistent storage
- **⚡ Memory Efficient**: Optimized memory usage with proper lifecycle management
- **📱 Cross-Platform**: Unified API for React Web and React Native

### Technical Highlights
- **Thread-Safe**: Concurrent data collection with proper synchronization
- **Lifecycle-Aware**: Automatic cleanup and resource management
- **Configurable**: Flexible configuration options for different use cases
- **Lightweight**: Minimal impact on app performance and bundle size
- **Modern Architecture**: Built with TypeScript and modern JavaScript APIs
- **Enhanced Performance Insights**: Consistent, detailed metrics for all users
- **Simplified Codebase**: Streamlined architecture with reduced complexity

## 📋 Requirements

### 🔄 **Platform Compatibility Matrix**

| Feature | **React Web** | **React Native** |
|---------|---------------|------------------|
| **React Version** | 17+ | 17+ |
| **Node.js** | 16+ | 16+ |
| **TypeScript** | 4.5+ | 4.5+ |
| **Bundle Size** | ~30KB | ~50KB |
| **Device Info** | ✅ Browser APIs | ✅ Native APIs |
| **Network Info** | ✅ Navigator API | ✅ NetInfo |
| **Crash Reporting** | ✅ | ✅ |
| **Navigation Tracking** | ✅ React Router | ✅ React Navigation |
| **Offline Storage** | ✅ LocalStorage | ✅ AsyncStorage |

### 📱 **Runtime Requirements**

#### **React Web**
- **React**: `>=17.0.0`
- **React DOM**: `>=17.0.0`
- **Modern Browsers**: Chrome 80+, Firefox 75+, Safari 13+, Edge 80+

#### **React Native**
- **React Native**: `>=0.64.0`
- **iOS**: `>=11.0`
- **Android**: `>=API 24` (Android 7.0+)

### 📦 **Dependencies**

#### **Core Dependencies**
- **UUID**: For unique ID generation
- **React Native Get Random Values**: For secure random generation

#### **Peer Dependencies (React Native)**
- **@react-native-async-storage/async-storage**: `>=1.21.0`
- **@react-native-community/netinfo**: `^11.4.1`
- **react-native-device-info**: `^12.0.0`

## 📦 Installation

### 🔄 **Choose Your Platform**

#### **React Web Projects**

```bash
npm install edge-telemetry-sdk
# or
yarn add edge-telemetry-sdk
```

**Requirements:**
- **React**: 17+
- **React DOM**: 17+
- **Features**: ✅ Full web support with user profiles

#### **React Native Projects**

```bash
npm install edge-telemetry-sdk
# or
yarn add edge-telemetry-sdk
```

**Install peer dependencies:**

```bash
# Required for React Native
npm install @react-native-async-storage/async-storage
npm install @react-native-community/netinfo
npm install react-native-device-info
npm install react-native-get-random-values

# iOS additional setup
cd ios && pod install
```

**Requirements:**
- **React Native**: 0.64+
- **iOS**: 11.0+
- **Android**: API 24+
- **Features**: ✅ Full native support with user profiles

### 🎯 **When to Use Each Platform**

| Use React Web | Use React Native |
|---------------|------------------|
| ✅ Web applications | ✅ Mobile applications |
| ✅ Browser-based analytics | ✅ Native device insights |
| ✅ SPA/PWA tracking | ✅ App store applications |
| ✅ E-commerce sites | ✅ Cross-platform apps |

## 🛠 Quick Setup

### 1. Initialize the SDK

#### React Web
```typescript
import { TelemetryWeb } from "edge-telemetry-sdk";

// Initialize in your main App component or index file
const telemetry = new TelemetryWeb({
  endpoint: "https://your-telemetry-endpoint.com/api/telemetry",
  batchSize: 10,
  flushIntervalMs: 30000
});

// Start collecting data
telemetry.log("app_started", { platform: "web" });
```

#### React Native
```typescript
import { TelemetryNative } from "edge-telemetry-sdk";

// Initialize in your App.js or App.tsx
const telemetry = new TelemetryNative({
  endpoint: "https://your-telemetry-endpoint.com/api/telemetry",
  batchSize: 10,
  flushIntervalMs: 30000
});

// Start collecting data
telemetry.log("app_started", { platform: "native" });
```

### 2. Automatic Data Collection

The SDK automatically starts collecting telemetry data once initialized:

- ✅ App lifecycle events
- ✅ Screen transitions
- ✅ Performance metrics
- ✅ Memory usage
- ✅ Crash reports
- ✅ User sessions
- ✅ Network connectivity
- ✅ Device information

### 3. Navigation Tracking

#### React Native with Expo Router
```typescript
import { useNavigationContainerRef } from "expo-router";
import { useEffect } from "react";
import { telemetry } from "../lib/telemetry";

export default function RootLayout() {
  const navigationRef = useNavigationContainerRef();

  useEffect(() => {
    telemetry.attachNavigation(navigationRef);
    telemetry.log("app_loaded", { platform: "native" });

    return () => telemetry.shutdown();
  }, [navigationRef]);

  return (
    // Your navigation setup
  );
}
```

#### React Native with React Navigation
```typescript
import { NavigationContainer } from '@react-navigation/native';
import { telemetry } from '../lib/telemetry';

function App() {
  const navigationRef = useRef();

  useEffect(() => {
    telemetry.attachNavigation(navigationRef);
  }, []);

  return (
    <NavigationContainer ref={navigationRef}>
      {/* Your navigation setup */}
    </NavigationContainer>
  );
}
```

#### React Web with React Router
```typescript
import { useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { telemetry } from '../lib/telemetry';

function App() {
  const location = useLocation();

  useEffect(() => {
    telemetry.trackRoute(location.pathname, location.pathname);
  }, [location]);

  return (
    // Your app content
  );
}
```

### 4. Set User Profile (Recommended)

Setting user profile information enriches all telemetry events with user context:

#### React Native
```typescript
import { TelemetryNative } from "edge-telemetry-sdk";

const telemetry = new TelemetryNative({
  endpoint: "https://your-telemetry-endpoint.com/api/telemetry"
});

// Set complete user profile after login
await telemetry.setUserProfile({
  fullName: "John Doe",
  firstName: "John",
  lastName: "Doe", 
  email: "john.doe@example.com",
  phone: "+1234567890",
  customAttributes: {
    subscription: "premium",
    signupDate: "2024-01-15",
    accountType: "business"
  }
});
```

#### React Web
```typescript
import { TelemetryWeb } from "edge-telemetry-sdk";

const telemetry = new TelemetryWeb({
  endpoint: "https://your-telemetry-endpoint.com/api/telemetry"
});

// Set user details
await telemetry.setUserDetails({
  fullName: "Jane Smith",
  email: "jane.smith@example.com",
  phone: "+1987654321"
});
```

### 5. Custom Event Tracking

#### TypeScript
```typescript
// Track custom events - user profile data automatically included
await telemetry.log("user_login", {
  method: "google",
  user_type: "premium",
  timestamp: Date.now()
});

// Track custom metrics
await telemetry.log("api_response_time", {
  endpoint: "/api/users",
  duration: 245,
  status: "success"
});
```

#### JavaScript
```javascript
// Track custom events - user profile data automatically included
telemetry.log("user_login", {
  method: "google",
  user_type: "premium",
  timestamp: Date.now()
});

// Track custom metrics
telemetry.log("api_response_time", {
  endpoint: "/api/users",
  duration: 245,
  status: "success"
});
```

## 📖 Usage Examples

### Advanced Configuration

#### React Native
```typescript
import { TelemetryNative } from "react-telemetry-lib";

const telemetry = new TelemetryNative({
  endpoint: "https://api.example.com/telemetry",
  batchSize: 20,
  flushIntervalMs: 60000,
  sender: {
    send: async (events) => {
      // Custom upload logic
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events })
      });
      return response.json();
    },
    onFailure: async (events) => {
      // Handle failed uploads
      console.warn('Failed to upload events:', events.length);
    },
    replayFailed: async () => {
      // Retry failed uploads
      console.log('Retrying failed uploads');
    }
  }
});
```

#### React Web
```typescript
import { TelemetryWeb } from "react-telemetry-lib";

const telemetry = new TelemetryWeb({
  endpoint: "https://api.example.com/telemetry",
  batchSize: 15,
  flushIntervalMs: 45000,
  sender: {
    send: async (events) => {
      // Custom upload with authentication
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAuthToken()}`
        },
        body: JSON.stringify({ events })
      });
      return response.json();
    }
  }
});
```

### User Profile Management

#### Complete Profile Setup
```typescript
// Set complete user profile with all details
await telemetry.setUserProfile({
  userId: "user_12345",           // Optional: custom user ID
  fullName: "John Doe",
  firstName: "John", 
  lastName: "Doe",
  email: "john.doe@example.com",
  phone: "+1234567890",
  avatar: "https://example.com/avatar.jpg",
  customAttributes: {
    subscription: "premium",
    signupDate: "2024-01-15",
    accountType: "business",
    preferences: {
      notifications: true,
      theme: "dark"
    }
  }
});
```

#### Convenience Methods
```typescript
// Set just name information
await telemetry.setUserName("John Doe", "John", "Doe");

// Set contact information only
await telemetry.setUserContact("john@example.com", "+1234567890");

// Set user details (alias for setUserProfile)
await telemetry.setUserDetails({
  fullName: "John Doe",
  email: "john@example.com"
});
```

#### Update Profile
```typescript
// Update specific fields without overwriting others
await telemetry.updateUserProfile({
  email: "newemail@example.com",
  customAttributes: {
    lastLogin: Date.now(),
    subscription: "enterprise"
  }
});

// Get current profile
const profile = await telemetry.getUserProfile();
console.log("Current user profile:", profile);
```

#### Profile Lifecycle
```typescript
// Generate automatic user ID
const userId = await telemetry.generateUserId();
console.log("Generated user ID:", userId);

// Set custom user ID
await telemetry.setUserId("custom_user_123");

// Clear profile on logout
await telemetry.clearUserProfile();
```

#### Real-World Example
```typescript
// Login flow
async function handleUserLogin(user) {
  await telemetry.setUserProfile({
    fullName: user.name,
    email: user.email,
    phone: user.phone,
    customAttributes: {
      subscription: user.subscription,
      signupDate: user.createdAt,
      lastLogin: Date.now()
    }
  });
  
  // This event will now include all user profile data
  await telemetry.log("user_login", {
    method: "email",
    success: true
  });
}

// Logout flow
async function handleUserLogout() {
  await telemetry.log("user_logout", { reason: "manual" });
  await telemetry.clearUserProfile();
}
```

### Screen Timing

```typescript
// Manual screen timing
await telemetry.screenStart("ProductDetails");

// ... user interacts with screen ...

await telemetry.screenEnd("ProductDetails");

// Track route changes
await telemetry.trackRoute("/home", "/product/123");
```

### Memory and Performance Monitoring

The SDK automatically tracks:
- **Memory Usage**: Heap size, used memory, memory warnings
- **Frame Drops**: Rendering performance issues
- **Network Requests**: Request timing and success rates
- **App Performance**: Startup time, background/foreground transitions

### Error and Crash Handling

```typescript
// Errors are automatically captured, but you can also manually log them
try {
  // Some risky operation
  await riskyOperation();
} catch (error) {
  await telemetry.log("manual_error", {
    error_message: error.message,
    error_stack: error.stack,
    context: "user_checkout"
  });
  throw error; // Re-throw if needed
}
```

## 🔧 Configuration

### Initialization Options

```typescript
interface TelemetryOptions {
  endpoint?: string;                    // Backend endpoint URL
  batchSize?: number;                   // Events per batch (default: 10)
  flushIntervalMs?: number;             // Auto-flush interval (default: 30000)
  sender?: Sender;                      // Custom sender implementation
  RandomnStringGenerator?: {            // Custom ID generator
    generate(): string;
  };
  deviceInfoHandler?: DeviceInfoHandler; // Custom device info collector
  networkInfoHandler?: NetworkInfoHandler; // Custom network info collector
}
```

### Environment-Specific Configuration

#### Development
```typescript
const telemetry = new TelemetryNative({
  endpoint: "https://dev-api.example.com/telemetry",
  batchSize: 5,        // Smaller batches for faster feedback
  flushIntervalMs: 10000, // More frequent flushing
});
```

#### Production
```typescript
const telemetry = new TelemetryNative({
  endpoint: "https://api.example.com/telemetry",
  batchSize: 25,       // Larger batches for efficiency
  flushIntervalMs: 60000, // Less frequent flushing
});
```

## 📊 Data Structure

### Event Types

The SDK collects various event types:

| Type | Description | Auto-Collected | Platform Support |
|------|-------------|----------------|------------------|
| `app.lifecycle` | App foreground/background | ✅ | Web + Native |
| `screen.view` | Screen/route transitions | ✅ | Web + Native |
| `app.crash` | Application crashes | ✅ | Web + Native |
| `app.error` | Non-fatal errors | ✅ | Web + Native |
| `performance.memory` | Memory usage tracking | ✅ | Web + Native |
| `performance.frame_drops` | Frame drop detection | ✅ | Native only |
| `network.request` | Network request monitoring | ✅ | Web + Native |
| `custom.event` | Custom business events | Manual | Web + Native |
| `custom.metric` | Custom performance metrics | Manual | Web + Native |

### Data Schema

#### Event with User Profile Data
```json
{
  "eventName": "user_login",
  "timestamp": 1704067200000,
  "type": "event",
  "userId": "user_1704067200000_abcd1234",
  "sessionId": "session_1704067200000_x9y8z7w6",
  "attributes": {
    "method": "google",
    "success": true,
    
    // User Profile Data (automatically included)
    "user.id": "user_1704067200000_abcd1234",
    "user.fullName": "John Doe",
    "user.firstName": "John",
    "user.lastName": "Doe",
    "user.email": "john.doe@example.com",
    "user.phone": "+1234567890",
    "user.avatar": "https://example.com/avatar.jpg",
    "user.createdAt": 1704067200000,
    "user.updatedAt": 1704067205000,
    "user.custom.subscription": "premium",
    "user.custom.signupDate": "2024-01-15",
    "user.custom.accountType": "business",
    
    // Device Information
    "device.id": "device_1704067200000_a8b9c2d1",
    "device.platform": "ios",
    "device.platformVersion": "17.0",
    "device.model": "iPhone 15 Pro",
    "device.manufacturer": "Apple",
    
    // Network Information
    "network.type": "wifi",
    "network.isConnected": true,
    "network.isInternetReachable": true,
    
    // Session Information
    "session.id": "session_1704067200000_x9y8z7w6",
    "session.event_count": 1,
    "timestamp": "2024-01-15T10:30:00.000Z"
  }
}
```

#### Event without User Profile
```json
{
  "eventName": "screen.view",
  "timestamp": 1704067200000,
  "type": "event",
  "userId": "user_1704067200000_abcd1234",
  "sessionId": "session_1704067200000_x9y8z7w6",
  "attributes": {
    "screen.name": "ProductDetails",
    "previous.screen": "ProductList",
    
    // Only basic user ID when no profile is set
    "user.id": "user_1704067200000_abcd1234",
    
    "device.id": "device_1704067200000_a8b9c2d1",
    "device.platform": "ios",
    "session.id": "session_1704067200000_x9y8z7w6",
    "timestamp": "2024-01-15T10:30:00.000Z"
  }
}
```

### Batch Structure

```json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "events": [
    {
      "eventName": "app.started",
      "timestamp": 1704067200000,
      "type": "event",
      "attributes": { /* event data */ }
    },
    {
      "eventName": "screen.view",
      "timestamp": 1704067205000,
      "type": "event", 
      "attributes": { /* event data */ }
    }
  ]
}
```

## 🔒 Privacy & Security

### Automatic ID Management
- **Device ID**: Persistent, unique device identifier
- **User ID**: Automatically generated, persistent across app sessions
- **Session ID**: Unique per app session, regenerated on app restart

### Data Collection
- **No PII**: No personally identifiable information collected by default
- **Configurable**: All data collection can be customized
- **Secure**: HTTPS-only transmission with proper error handling
- **Local Storage**: Sensitive data encrypted in local storage

### Privacy Controls
```typescript
// Disable specific data collection
const telemetry = new TelemetryNative({
  endpoint: "https://api.example.com/telemetry",
  collectDeviceInfo: false,    // Disable device info collection
  collectNetworkInfo: false,   // Disable network info collection
  collectCrashReports: false,  // Disable crash reporting
});

// Clear all stored data
await telemetry.clearAllData();

// Opt out of data collection
await telemetry.setOptOut(true);
```

## 🏗 Architecture

### Core Components

```
TelemetryNative/TelemetryWeb (Main SDK Interface)
├── Telemetry (Core Engine)
│   ├── Event Queue Management
│   ├── Batch Processing
│   ├── Session Management
│   └── User Management
├── Senders (Network Layer)
│   ├── NativeSender (React Native)
│   ├── WebSender (React Web)
│   └── Retry Logic
├── Adapters (Platform-Specific)
│   ├── DeviceInfo (Native/Web)
│   ├── NetworkInfo (Native/Web)
│   ├── CrashHandler (Native/Web)
│   ├── MemoryTracker (Native/Web)
│   └── NavigationTracker (Native/Web)
└── Storage (Persistence)
    ├── AsyncStorage (React Native)
    └── LocalStorage (React Web)
```

### Key Features
- **Memory Leak Prevention**: Proper cleanup of listeners and observers
- **Thread Safety**: Concurrent access protection with proper synchronization
- **Performance Optimized**: Minimal impact on app performance
- **Robust Networking**: Retry logic with exponential backoff
- **Cross-Platform**: Unified API with platform-specific optimizations
- **Modular Architecture**: Easy to extend and customize

## 🧪 Testing

### Unit Tests
```bash
npm test
```

### Build Library
```bash
npm run build
```

### Development Mode
```bash
npm run dev
```

### Clean Build
```bash
npm run clean
```

## 📈 Performance Impact

### React Web
- **Bundle Size**: ~30KB (gzipped)
- **Memory**: <1MB runtime usage
- **CPU**: Minimal background processing
- **Network**: Efficient batching reduces requests

### React Native
- **Bundle Size**: ~50KB
- **Memory**: <2MB runtime usage
- **Battery**: Negligible impact
- **CPU**: Minimal background processing
- **Network**: Efficient batching reduces requests

## 🔧 Troubleshooting

### Common Issues

**SDK not collecting data:**
```typescript
// Ensure proper initialization
const telemetry = new TelemetryNative({
  endpoint: "https://your-endpoint.com/telemetry",
  batchSize: 10
});

// Check if instance is ready
telemetry.log("test_event", { test: true })
  .then(() => console.log("SDK working"))
  .catch(err => console.error("SDK error:", err));
```

**Network issues:**
- Verify endpoint URL is correct and accessible
- Check CORS settings for web applications
- Review network logs for HTTP error codes
- Ensure proper SSL/TLS configuration

**React Native specific issues:**
```bash
# iOS: Ensure pods are installed
cd ios && pod install

# Android: Ensure proper permissions in AndroidManifest.xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
```

**Memory issues:**
- SDK automatically manages memory and prevents leaks
- Ensure proper component unmounting
- Use `telemetry.shutdown()` when appropriate

### Debug Logging

Enable debug logging to troubleshoot issues:

```typescript
// Enable console logging for debugging
const telemetry = new TelemetryNative({
  endpoint: "https://api.example.com/telemetry",
  batchSize: 5, // Smaller batch for faster debugging
  flushIntervalMs: 10000 // More frequent flushing
});

// Monitor events in console
telemetry.log("debug_event", { debug: true });
```

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

### Development Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Run tests: `npm test`
4. Build library: `npm run build`
5. Start development: `npm run dev`

### Project Structure
```
src/
├── core/                 # Core telemetry engine
├── adapters/            # Platform-specific adapters
│   ├── native/         # React Native adapters
│   └── web/            # React Web adapters
├── index.native.ts     # React Native entry point
├── index.web.ts        # React Web entry point
└── shims/              # Platform shims
```

## 📄 License

This project is licensed under the ISC License - see the [LICENSE](LICENSE) file for details.

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/your-org/react-telemetry-lib/issues)
- **Documentation**: [Wiki](https://github.com/your-org/react-telemetry-lib/wiki)
- **Email**: support@your-org.com

## 🗺 Roadmap

- [ ] Real-time analytics dashboard
- [ ] Advanced filtering and sampling
- [ ] Custom data retention policies
- [ ] Enhanced privacy controls
- [ ] Performance benchmarking tools
- [ ] React Server Components support
- [ ] Next.js App Router integration
- [ ] Expo SDK integration improvements

---

**Made with ❤️ by NCG Africa**
