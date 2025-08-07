/**
 * Performance monitoring types matching Flutter SDK
 * Phase 10: Performance Monitoring
 */

/**
 * Performance metric categories
 */
export type PerformanceCategory = 
  | 'startup'
  | 'memory'
  | 'bridge'
  | 'bundle'
  | 'render'
  | 'network'
  | 'custom';

/**
 * Performance metric types
 */
export type PerformanceMetricType =
  | 'gauge'
  | 'counter'
  | 'histogram'
  | 'timer';

/**
 * Startup performance metrics
 */
export interface StartupMetrics {
  appStartTime: number;
  jsLoadTime: number;
  bundleLoadTime: number;
  nativeInitTime: number;
  firstRenderTime: number;
  timeToInteractive: number;
}

/**
 * Memory performance metrics
 */
export interface MemoryMetrics {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
  nativeHeapSize?: number;
  imageMemoryUsage?: number;
  memoryWarnings: number;
}

/**
 * Bridge performance metrics
 */
export interface BridgeMetrics {
  bridgeCallCount: number;
  averageBridgeCallTime: number;
  maxBridgeCallTime: number;
  bridgeQueueSize: number;
  bridgeCallsPerSecond: number;
}

/**
 * Bundle performance metrics
 */
export interface BundleMetrics {
  bundleSize: number;
  loadTime: number;
  parseTime: number;
  executionTime: number;
  cacheHitRate: number;
}

/**
 * Performance event for telemetry
 */
export interface PerformanceEvent {
  category: PerformanceCategory;
  metricName: string;
  metricType: PerformanceMetricType;
  value: number;
  unit: string;
  timestamp: Date;
  attributes?: Record<string, any>;
  duration?: number;
  startTime?: number;
  endTime?: number;
}

/**
 * Performance telemetry attributes matching Flutter
 */
export interface PerformanceTelemetryAttributes {
  'performance.category': string;
  'performance.metric_name': string;
  'performance.metric_type': string;
  'performance.value': string;
  'performance.unit': string;
  'performance.duration'?: string;
  'performance.start_time'?: string;
  'performance.end_time'?: string;
  'performance.device_type'?: string;
  'performance.platform'?: string;
  'performance.app_version'?: string;
  'performance.session_id'?: string;
  'performance.user_id'?: string;
  [key: string]: string | undefined;
}

/**
 * Performance monitoring configuration
 */
export interface PerformanceConfig {
  enableStartupMonitoring: boolean;
  enableMemoryMonitoring: boolean;
  enableBridgeMonitoring: boolean;
  enableBundleMonitoring: boolean;
  enableRenderMonitoring: boolean;
  enableNetworkMonitoring: boolean;
  
  // Monitoring intervals (in milliseconds)
  memoryMonitoringInterval: number;
  bridgeMonitoringInterval: number;
  
  // Thresholds
  memoryWarningThreshold: number; // MB
  bridgeCallTimeThreshold: number; // ms
  renderTimeThreshold: number; // ms
  
  // Sampling
  performanceSampleRate: number; // 0.0 to 1.0
  enablePerformanceTracing: boolean;
  
  // Debug
  debugMode: boolean;
}

/**
 * Performance monitor status
 */
export interface PerformanceMonitorStatus {
  initialized: boolean;
  activeMonitors: string[];
  config: PerformanceConfig;
  metrics: {
    startup?: Partial<StartupMetrics>;
    memory?: Partial<MemoryMetrics>;
    bridge?: Partial<BridgeMetrics>;
    bundle?: Partial<BundleMetrics>;
  };
  lastUpdated: Date;
}

/**
 * Performance timing entry (similar to Web Performance API)
 */
export interface PerformanceTimingEntry {
  name: string;
  entryType: string;
  startTime: number;
  duration: number;
  category: PerformanceCategory;
  attributes?: Record<string, any>;
}

/**
 * Performance observer callback
 */
export type PerformanceObserverCallback = (entries: PerformanceTimingEntry[]) => void;

/**
 * Manual performance tracking options
 */
export interface ManualPerformanceOptions {
  metricName: string;
  category: PerformanceCategory;
  metricType: PerformanceMetricType;
  value: number;
  unit: string;
  attributes?: Record<string, any>;
  duration?: number;
  startTime?: number;
  endTime?: number;
}
