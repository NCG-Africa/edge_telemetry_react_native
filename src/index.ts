// EdgeTelemetry React Native SDK
// Main entry point

export { EdgeTelemetry } from './EdgeTelemetry';

// Core models and interfaces
export type { TelemetryEvent } from './core/models/TelemetryEvent';
export type { TelemetrySession } from './core/models/TelemetrySession';
export type { UserProfile } from './core/models/UserProfile';
export type { TelemetryConfig, TelemetryInitConfig } from './core/config/TelemetryConfig';
export type { DeviceInfoCollector } from './core/interfaces/DeviceInfoCollector';
export type { EventTracker } from './core/interfaces/EventTracker';

// Managers
export { UserIdManager } from './managers/UserIdManager';
export { SessionManager } from './managers/SessionManager';
export { SpanManager } from './managers/SpanManager';

// Collectors
export { ReactNativeDeviceInfoCollector } from './collectors/ReactNativeDeviceInfoCollector';

// Utilities
export { AttributeConverter } from './core/AttributeConverter';

// HTTP Monitoring (Phase 7)
export {
  NetworkMonitorManager,
  HttpRequestTelemetry,
  HttpTelemetryCollector,
  HttpMetricsTracker,
  FetchInterceptor,
  XMLHttpRequestInterceptor,
  AxiosInterceptor,
  Duration,
  TimingUtils,
  UrlUtils,
  NetworkUtils,
  NetworkConnectionType,
  NetworkQuality
} from './http';
export type {
  HttpRequestTelemetryData,
  HttpGlobalMetrics,
  HttpDomainMetrics,
  Timer,
  NetworkInfo
} from './http';
