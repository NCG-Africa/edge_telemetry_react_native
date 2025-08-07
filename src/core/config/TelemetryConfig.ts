/**
 * TelemetryConfig - Must mirror Flutter SDK exactly
 * Configuration options for the EdgeTelemetry SDK
 */
export interface TelemetryConfig {
  /** Service name for telemetry identification */
  serviceName: string;
  
  /** Endpoint URL for telemetry data export */
  endpoint: string;
  
  /** Enable debug mode with verbose logging */
  debugMode: boolean;
  
  /** Debug mode alias for compatibility */
  debug: boolean;
  
  /** Global attributes added to all events */
  globalAttributes: Record<string, string>;
  
  /** Timeout for batch operations in milliseconds */
  batchTimeout: number;
  
  /** Maximum number of events per batch */
  maxBatchSize: number;
  
  /** Batch size for telemetry events */
  batchSize: number;
  
  /** Enable automatic network request monitoring */
  enableNetworkMonitoring: boolean;
  
  /** Enable performance monitoring */
  enablePerformanceMonitoring: boolean;
  
  /** Enable React Navigation tracking */
  enableNavigationTracking: boolean;
  
  /** Enable HTTP request/response monitoring */
  enableHttpMonitoring: boolean;
  
  /** HTTP monitoring alias for compatibility */
  httpMonitoring: boolean;
  
  /** Performance monitoring alias for compatibility */
  performanceMonitoring: boolean;
  
  /** URLs to ignore in HTTP monitoring */
  httpIgnoredUrls: string[];
  
  /** Domains to ignore in HTTP monitoring */
  httpIgnoredDomains: string[];
  
  /** Enable local crash reporting */
  enableLocalReporting: boolean;
  
  /** Enable error and crash reporting */
  enableErrorReporting: boolean;
  
  /** Enable storage and caching layer */
  enableStorageAndCaching: boolean;
  
  /** Use JSON format instead of OpenTelemetry */
  useJsonFormat: boolean;
  
  /** Number of events to batch before sending */
  eventBatchSize: number;
}

/**
 * Initialization configuration provided by the developer
 */
export interface TelemetryInitConfig {
  /** Service name for identification */
  serviceName: string;
  
  /** Backend endpoint URL */
  endpoint: string;
  
  /** Enable debug logging (default: false) */
  debugMode?: boolean;
  
  /** Global attributes to add to all events */
  globalAttributes?: Record<string, string>;
  
  /** Batch timeout in milliseconds (default: 30000) */
  batchTimeout?: number;
  
  /** Maximum batch size (default: 100) */
  maxBatchSize?: number;
  
  /** Enable network monitoring (default: true) */
  enableNetworkMonitoring?: boolean;
  
  /** Enable performance monitoring (default: true) */
  enablePerformanceMonitoring?: boolean;
  
  /** Enable navigation tracking (default: true) */
  enableNavigationTracking?: boolean;
  
  /** Enable HTTP monitoring (default: true) */
  enableHttpMonitoring?: boolean;
  
  /** Enable local reporting (default: true) */
  enableLocalReporting?: boolean;
  
  /** Enable error and crash reporting (default: true) */
  enableErrorReporting?: boolean;
  
  /** Enable storage and caching layer (default: true) */
  enableStorageAndCaching?: boolean;
  
  /** Use JSON format (default: false, uses OpenTelemetry) */
  useJsonFormat?: boolean;
  
  /** Event batch size (default: 30) */
  eventBatchSize?: number;
}

/**
 * Default configuration values matching Flutter SDK
 */
export const DEFAULT_CONFIG: Omit<TelemetryConfig, 'serviceName' | 'endpoint'> = {
  debugMode: false,
  debug: false, // Alias for debugMode
  globalAttributes: {},
  batchTimeout: 30000, // 30 seconds
  maxBatchSize: 100,
  batchSize: 50, // For HTTP monitoring
  enableNetworkMonitoring: true,
  enablePerformanceMonitoring: true,
  performanceMonitoring: true, // Alias for enablePerformanceMonitoring
  enableNavigationTracking: true,
  enableHttpMonitoring: true,
  httpMonitoring: true, // Alias for enableHttpMonitoring
  httpIgnoredUrls: [],
  httpIgnoredDomains: [],
  enableLocalReporting: true,
  enableErrorReporting: true,
  enableStorageAndCaching: true,
  useJsonFormat: false,
  eventBatchSize: 30,
};
