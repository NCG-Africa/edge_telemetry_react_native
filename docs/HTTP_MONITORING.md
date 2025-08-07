# HTTP Monitoring - Phase 7 Documentation

## Overview

The EdgeTelemetry React Native SDK now includes comprehensive HTTP monitoring capabilities that automatically track all HTTP requests made by your application. This feature provides detailed insights into network performance, error rates, and usage patterns with zero additional code required after initialization.

## Features

### Automatic HTTP Request Monitoring
- **Fetch API Interception**: Automatically monitors all `fetch()` requests
- **XMLHttpRequest Interception**: Monitors traditional XHR requests
- **Axios Integration**: Optional Axios instance monitoring
- **Zero Configuration**: Works out of the box with default settings

### Telemetry Data Collection
- **Request/Response Timing**: Precise duration measurements using high-resolution timers
- **Status Code Tracking**: HTTP response status categorization
- **Error Detection**: Network errors and HTTP error responses
- **Performance Categorization**: Fast, normal, slow, and very slow request classification
- **Data Size Tracking**: Request and response payload sizes

### Privacy & Security
- **URL Sanitization**: Automatic removal of sensitive query parameters
- **Header Sanitization**: Redaction of authentication and sensitive headers
- **Configurable Ignore Lists**: Skip monitoring for specific URLs or domains
- **Data Minimization**: Only essential telemetry data is collected

## Quick Start

### Basic Setup

```typescript
import { EdgeTelemetry } from '@edge-telemetry/react-native';

// Initialize with HTTP monitoring enabled (default)
await EdgeTelemetry.initialize({
  serviceName: 'my-app',
  endpoint: 'https://telemetry.myservice.com',
  enableHttpMonitoring: true, // Default: true
  debugMode: false
});
```

### Axios Integration

```typescript
import axios from 'axios';
import { EdgeTelemetry } from '@edge-telemetry/react-native';

// Initialize EdgeTelemetry first
await EdgeTelemetry.initialize({
  serviceName: 'my-app',
  endpoint: 'https://telemetry.myservice.com'
});

// Install Axios interceptor
const axiosInstance = axios.create();
EdgeTelemetry.getInstance().installAxiosInterceptor(axiosInstance);

// All requests through this instance will be monitored
const response = await axiosInstance.get('https://api.example.com/users');
```

## Configuration Options

### HTTP Monitoring Settings

```typescript
await EdgeTelemetry.initialize({
  serviceName: 'my-app',
  endpoint: 'https://telemetry.myservice.com',
  
  // HTTP Monitoring Configuration
  enableHttpMonitoring: true,
  httpIgnoredUrls: [
    'https://analytics.example.com/*',
    'https://crashlytics.googleapis.com/*'
  ],
  httpIgnoredDomains: [
    'telemetry.myservice.com',
    'logging.internal.com'
  ],
  
  // Performance Monitoring
  enablePerformanceMonitoring: true,
  
  // Debug Mode
  debugMode: false
});
```

### Configuration Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `enableHttpMonitoring` | `boolean` | `true` | Enable/disable HTTP request monitoring |
| `httpIgnoredUrls` | `string[]` | `[]` | URLs to ignore (supports wildcards) |
| `httpIgnoredDomains` | `string[]` | `[]` | Domains to ignore completely |
| `enablePerformanceMonitoring` | `boolean` | `true` | Enable performance event generation |
| `debugMode` | `boolean` | `false` | Enable verbose logging |

## Telemetry Events

### HTTP Request Event

Generated for every HTTP request:

```json
{
  "id": "http_1641234567890_abc123",
  "type": "http_request",
  "timestamp": "2023-01-01T12:00:00.000Z",
  "attributes": {
    "http.url": "https://api.example.com/users",
    "http.method": "GET",
    "http.status_code": "200",
    "http.duration_ms": "150",
    "http.success": "true",
    "http.category": "success",
    "http.performance": "normal",
    "event.category": "http",
    "event.action": "request",
    "event.outcome": "success",
    "network.connected": "true",
    "network.type": "wifi",
    "network.quality": "good"
  },
  "metrics": {
    "http.duration": 150,
    "http.response_size": 1024,
    "http.request_size": 256
  }
}
```

### HTTP Error Event

Generated for failed HTTP requests:

```json
{
  "id": "http_1641234567891_def456",
  "type": "http_error",
  "timestamp": "2023-01-01T12:00:01.000Z",
  "attributes": {
    "http.url": "https://api.example.com/error",
    "http.method": "POST",
    "http.status_code": "500",
    "http.duration_ms": "200",
    "error.type": "server_error",
    "error.message": "Internal Server Error",
    "severity": "error",
    "event.category": "error",
    "event.action": "http_request_failed"
  },
  "metrics": {
    "http.duration": 200,
    "error.count": 1
  }
}
```

### HTTP Performance Event

Generated for slow HTTP requests (>2000ms):

```json
{
  "id": "http_1641234567892_ghi789",
  "type": "http_performance",
  "timestamp": "2023-01-01T12:00:02.000Z",
  "attributes": {
    "http.url": "https://api.example.com/slow",
    "http.method": "GET",
    "http.status_code": "200",
    "http.duration_ms": "3000",
    "performance.issue": "slow_response",
    "performance.threshold_ms": "2000",
    "event.category": "performance",
    "event.action": "slow_http_request"
  },
  "metrics": {
    "http.duration": 3000,
    "performance.slowness_factor": 1.5
  }
}
```

## Response Categories

HTTP responses are automatically categorized:

| Status Code Range | Category | Description |
|-------------------|----------|-------------|
| 200-299 | `success` | Successful responses |
| 300-399 | `redirect` | Redirection responses |
| 400-499 | `client_error` | Client error responses |
| 500-599 | `server_error` | Server error responses |
| 0 or Network Error | `network_error` | Network connectivity issues |

## Performance Categories

Requests are categorized by response time:

| Response Time | Category | Description |
|---------------|----------|-------------|
| < 100ms | `fast` | Very responsive |
| 100-500ms | `normal` | Good performance |
| 500-2000ms | `slow` | Noticeable delay |
| > 2000ms | `very_slow` | Poor performance |

## Advanced Usage

### Manual Interceptor Management

```typescript
import { 
  FetchInterceptor, 
  XMLHttpRequestInterceptor,
  AxiosInterceptor 
} from '@edge-telemetry/react-native';

// Install interceptors manually
FetchInterceptor.install(
  (telemetry) => console.log('HTTP Request:', telemetry),
  {
    ignoredUrls: ['https://ignore.com/*'],
    ignoredDomains: ['analytics.com']
  }
);

// Check interceptor status
console.log('Fetch interceptor installed:', FetchInterceptor.installed);

// Uninstall when done
FetchInterceptor.uninstall();
```

### Custom Telemetry Processing

```typescript
import { HttpTelemetryCollector, HttpMetricsTracker } from '@edge-telemetry/react-native';

// Create custom collector
const collector = new HttpTelemetryCollector(['http_request', 'http_error']);

// Create metrics tracker
const tracker = new HttpMetricsTracker();

// Process HTTP telemetry
const httpTelemetry = new HttpRequestTelemetry({
  url: 'https://api.example.com/test',
  method: 'GET',
  statusCode: 200,
  duration: new Duration(150),
  timestamp: new Date()
});

const events = collector.processHttpRequest(httpTelemetry);
tracker.trackRequest(httpTelemetry);

// Get metrics
const globalMetrics = tracker.getGlobalMetrics();
console.log('Total requests:', globalMetrics.totalRequests);
console.log('Average response time:', globalMetrics.averageResponseTime.inMilliseconds);
```

### Network Quality Monitoring

```typescript
import { NetworkUtils } from '@edge-telemetry/react-native';

// Initialize network monitoring
await NetworkUtils.initialize();

// Get current network info
const networkInfo = NetworkUtils.getCurrentNetworkInfo();
console.log('Connection type:', networkInfo.connectionType);
console.log('Network quality:', networkInfo.quality);
console.log('Is expensive:', networkInfo.isExpensive);

// Listen for network changes
const unsubscribe = NetworkUtils.addNetworkListener((info) => {
  console.log('Network changed:', info);
});

// Check if suitable for uploads
if (NetworkUtils.isSuitableForUpload()) {
  // Proceed with telemetry upload
}
```

## Monitoring Status

### Get HTTP Monitoring Status

```typescript
const status = EdgeTelemetry.getInstance().getHttpMonitoringStatus();

console.log('HTTP monitoring enabled:', status.enabled);
console.log('Buffer size:', status.bufferSize);
console.log('Network info:', status.networkInfo);
console.log('Interceptor stats:', status.interceptors);
console.log('Metrics summary:', status.metrics);
```

### Example Status Response

```json
{
  "enabled": true,
  "initialized": true,
  "httpMonitoring": true,
  "bufferSize": 15,
  "networkInfo": {
    "isConnected": true,
    "connectionType": "wifi",
    "quality": "good",
    "isExpensive": false
  },
  "interceptors": {
    "fetch": { "installed": true, "ignoredUrlsCount": 2, "ignoredDomainsCount": 1 },
    "xhr": { "installed": true, "ignoredUrlsCount": 2, "ignoredDomainsCount": 1 },
    "axios": { "installedInstancesCount": 1, "ignoredUrlsCount": 2, "ignoredDomainsCount": 1 }
  },
  "metrics": {
    "http.total_requests": 150,
    "http.successful_requests": 142,
    "http.failed_requests": 8,
    "http.error_rate": 0.053,
    "http.average_response_time_ms": 245,
    "http.domains_count": 5
  }
}
```

## Privacy Considerations

### Automatic Data Sanitization

The SDK automatically sanitizes sensitive data:

- **Query Parameters**: Removes common sensitive parameters (token, password, key, etc.)
- **Headers**: Redacts authentication headers (Authorization, Cookie, etc.)
- **URL Length**: Truncates very long URLs
- **Error Messages**: Sanitizes error messages to prevent data leakage

### Sensitive Parameters (Auto-Redacted)

- `password`, `token`, `key`, `secret`, `auth`
- `authorization`, `api_key`, `apikey`
- `access_token`, `refresh_token`
- `session`, `sessionid`, `csrf`, `csrf_token`
- `signature`, `sig`

### Sensitive Headers (Auto-Redacted)

- `authorization`, `cookie`, `set-cookie`
- `x-api-key`, `x-auth-token`, `x-csrf-token`
- `x-session-id`, `authentication`
- `proxy-authorization`

## Performance Impact

The HTTP monitoring system is designed for minimal performance impact:

- **Lightweight Interceptors**: Minimal overhead on request/response processing
- **Efficient Batching**: Events are batched to reduce processing overhead
- **Smart Sampling**: Optional sampling for high-traffic applications
- **Memory Management**: Automatic cleanup of old metrics and events
- **Network Awareness**: Respects network conditions for telemetry uploads

## Troubleshooting

### Common Issues

1. **Tests Failing**: Ensure Jest is configured to handle React Native modules
2. **Missing Events**: Check if URLs are in the ignore list
3. **High Memory Usage**: Reduce batch size or enable sampling
4. **Network Errors**: Verify endpoint accessibility and network permissions

### Debug Mode

Enable debug mode for detailed logging:

```typescript
await EdgeTelemetry.initialize({
  serviceName: 'my-app',
  endpoint: 'https://telemetry.myservice.com',
  debugMode: true // Enable verbose logging
});
```

Debug output includes:
- HTTP request summaries
- Interceptor installation status
- Event processing information
- Network state changes
- Telemetry upload attempts

## Flutter Compatibility

The HTTP monitoring implementation maintains 100% compatibility with the Flutter EdgeTelemetry SDK:

- **Identical Event Structure**: Same JSON schema and attribute names
- **Compatible Metrics**: Same metric names and value formats  
- **Consistent Categorization**: Same logic for status and performance categories
- **Backend Compatibility**: Events can be processed by the same backend systems

This ensures seamless integration in cross-platform applications using both React Native and Flutter SDKs.
