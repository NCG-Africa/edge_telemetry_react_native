// EdgeTelemetry React Native SDK
// Main entry point

export { EdgeTelemetry } from './EdgeTelemetry';
export * from './core/interfaces/index';
export * from './core/models/index';
export * from './core/config/index';

// Re-export commonly used types
export type {
  TelemetryEvent,
  TelemetrySession,
  UserProfile
} from './core/models/index';

export type {
  TelemetryConfig,
  TelemetryInitConfig
} from './core/config/index';

export type {
  DeviceInfoCollector,
  EventTracker
} from './core/interfaces/index';
