/**
 * Contract interface for telemetry systems used within the EdgeTelemetry SDK
 */
export interface TelemetryClient {
  /** Initializes the telemetry system (e.g., starts a session) */
  start(): void;

  /** Tracks a custom telemetry event with optional key-value attributes */
  trackEvent(name: string, attributes?: Record<string, any>): void;

  /** Records an exception (e.g., handled error), optionally with extra context */
  recordException(error: Error, context?: Record<string, any>): void;

  /** Cleanly shuts down or disables the telemetry system */
  shutdown(): void;
}