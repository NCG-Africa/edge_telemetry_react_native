/**
 * Configuration interface for EdgeTelemetry initialization
 */
export interface EdgeTelemetryConfig {
  /** The name of the application */
  appName: string;
  
  /** The URL where telemetry data will be sent */
  exportUrl: string;
  
  /** Optional flag to enable debug logging */
  debug?: boolean;
}
