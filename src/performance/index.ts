/**
 * Performance monitoring module exports
 * Phase 10: Performance Monitoring
 */

// Main manager
export { PerformanceMonitorManager } from './PerformanceMonitorManager';

// Performance monitors
export { StartupTimeMonitor } from './monitors/StartupTimeMonitor';
export { MemoryMonitor } from './monitors/MemoryMonitor';
export { BridgePerformanceMonitor } from './monitors/BridgePerformanceMonitor';
export { BundleMetricsMonitor } from './monitors/BundleMetricsMonitor';

// Performance collector
export { PerformanceCollector } from './collectors/PerformanceCollector';

// Types
export type {
  PerformanceCategory,
  PerformanceMetricType,
  PerformanceEvent,
  PerformanceTimingEntry,
  PerformanceTelemetryAttributes,
  PerformanceConfig,
  PerformanceMonitorStatus,
  StartupMetrics,
  MemoryMetrics,
  BridgeMetrics,
  BundleMetrics,
  ManualPerformanceOptions,
  PerformanceObserverCallback
} from './types/PerformanceTypes';
