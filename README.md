# EdgeTelemetry SDK (React Native)

**EdgeTelemetry** is a lightweight, production-ready React Native SDK that automatically collects mobile app telemetry and exports it to your backend in JSON format. Built with developer experience in mind, it provides comprehensive observability with zero vendor lock-in.

## Features / Telemetry Collected

EdgeTelemetry automatically instruments your React Native app to collect:

- **Crashes** - JavaScript errors and native crashes
- **ANRs** - Application Not Responding events
- **Screen Views** - Automatic React Navigation tracking
- **Network Requests** - HTTP requests with timing and status codes
- **Custom Events** - Track business metrics via `trackEvent()` API
- **Performance Data** - App launch times and user interactions

**Key Benefits:**
- **Auto-setup** - Works out of the box with minimal configuration
- **JSON Export** - Send data to any backend endpoint
- **Configurable Batching** - Control batch sizes and export frequency
- **Debug Mode** - Comprehensive logging for development
- **Clean Architecture** - Extensible and maintainable codebase

## Installation

### npm
```bash
npm install edge-telemetry-react-native
```

### yarn
```bash
yarn add edge-telemetry-react-native
```

## Configuration & Initialization

Initialize EdgeTelemetry in your app's root component (typically `App.tsx` or `index.js`):

```typescript
import { EdgeTelemetry } from 'edge-telemetry-react-native';

// Initialize the SDK
const initTelemetry = async () => {
  await EdgeTelemetry.init({
    appName: 'MyAwesomeApp',
    exportUrl: 'https://api.mycompany.com/telemetry',
    debug: __DEV__, // Enable debug logging in development
    batchSize: 30   // Optional: customize batch size
  });
};

// Call during app startup
initTelemetry();
```

### Configuration Options

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `appName` | `string` | | - | Your application name for telemetry identification |
| `exportUrl` | `string` | | - | Backend endpoint URL where telemetry data will be sent |
| `debug` | `boolean` | | `false` | Enable detailed logging for development and debugging |
| `batchSize` | `number` | | `30` | Number of events to batch before sending to backend |

## Usage Examples

### Track Custom Events

```typescript
import { EdgeTelemetry } from 'edge-telemetry-react-native';

// Track user interactions
EdgeTelemetry.trackEvent('user.button_click', {
  buttonId: 'checkout-button',
  screen: 'ProductDetails',
  userId: '12345'
});

// Track business metrics
EdgeTelemetry.trackEvent('purchase.completed', {
  orderId: 'order-789',
  amount: 99.99,
  currency: 'USD',
  paymentMethod: 'credit_card'
});

// Track feature usage
EdgeTelemetry.trackEvent('feature.used', {
  featureName: 'dark_mode',
  enabled: true
});
```

### Automatic Telemetry

Once initialized, EdgeTelemetry automatically tracks:

```typescript
// Screen navigation (automatic)
// No code needed - works with React Navigation

// Network requests (automatic)
fetch('https://api.example.com/data')
  .then(response => response.json())
  .then(data => {
    // Request automatically tracked with timing and status
  });

// Errors and crashes (automatic)
throw new Error('Something went wrong'); // Automatically captured
```

## Export Format

Telemetry data is sent to your backend in the following JSON format:

```json
{
  "timestamp": "2025-01-23T15:30:00.000Z",
  "data": {
    "type": "batch",
    "events": [
      {
        "eventName": "user.button_click",
        "timestamp": "2025-01-23T15:29:45.123Z",
        "appName": "MyAwesomeApp",
        "attributes": {
          "buttonId": "checkout-button",
          "screen": "ProductDetails"
        }
      },
      {
        "type": "screen.view",
        "screen": "HomeScreen",
        "previousScreen": "LoginScreen",
        "timestamp": "2025-01-23T15:29:50.456Z",
        "timeOnPreviousScreen": 5000,
        "source": "internal"
      },
      {
        "type": "network.request",
        "url": "https://api.example.com/users",
        "method": "GET",
        "status": 200,
        "duration": 245,
        "timestamp": "2025-01-23T15:29:55.789Z",
        "source": "internal"
      }
    ],
    "batch_size": 3,
    "timestamp": "2025-01-23T15:30:00.000Z"
  }
}
```

### Event Types

- **User Events**: Custom events tracked via `trackEvent()`
- **Internal Events**: Automatically collected telemetry marked with `"source": "internal"`
  - `screen.view` - Screen navigation events
  - `network.request` - HTTP request telemetry
  - `error.javascript` - JavaScript errors
  - `error.unhandled_promise` - Unhandled promise rejections

## Architecture

EdgeTelemetry follows Clean Architecture principles for maintainability and extensibility:

- **Core Layer**: `EdgeTelemetry` coordinator and configuration
- **Domain Layer**: `TelemetryClient` interface defining telemetry contracts
- **Data Layer**: Concrete implementations (`EmbraceClient`, `JsonExporter`)
- **Infrastructure**: Platform-specific integrations and network handling

### Internal Dependencies

- **Embrace SDK**: Used internally for robust crash reporting and native telemetry
- **React Navigation**: Optional integration for automatic screen tracking
- **Fetch API**: Intercepted for automatic network request monitoring

## Future Work & Enhancements

- **Enhanced Error Handling**: Add support for handled exceptions and custom error boundaries
- **Expo Web Support**: Optional polyfills for web platform compatibility
- **Advanced Filtering**: Opt-in screen and network request filtering capabilities
- **Plugin System**: Third-party enrichers and custom telemetry processors
- **OpenTelemetry Integration**: Export OpenTelemetry-compatible spans (experimental)
- **Offline Support**: Queue telemetry when network is unavailable
- **Performance Metrics**: Detailed app performance and user experience metrics
- **Custom Sampling**: Configurable sampling rates for high-volume applications

## Troubleshooting

### Enable Debug Mode

```typescript
await EdgeTelemetry.init({
  appName: 'MyApp',
  exportUrl: 'https://api.example.com/telemetry',
  debug: true // Enable detailed logging
});
```

Debug mode provides detailed console logs:
- `[EdgeTelemetry] Internal event captured: screen.view → added to batch`
- `JsonExporter: Exporting batch of 30 events to https://api.example.com/telemetry`
- `EdgeTelemetry: SDK initialized successfully`

### Common Issues

**SDK not collecting data?**
- Ensure `EdgeTelemetry.init()` is called before any other SDK usage
- Check that `exportUrl` is a valid, reachable endpoint
- Enable debug mode to see detailed logs

**Network requests not being tracked?**
- Ensure you're using the standard `fetch` API
- Custom HTTP libraries may require manual integration

**Screen tracking not working?**
- Ensure React Navigation is properly set up
- Screen tracking requires React Navigation v5+ integration

## License

MIT License - see LICENSE file for details.

---

**Built with ❤️ for the React Native community**
