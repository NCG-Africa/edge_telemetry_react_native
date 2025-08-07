/**
 * Error monitoring module exports
 * Phase 9: Error & Crash Reporting
 */

// Main manager
export { ErrorMonitorManager } from './ErrorMonitorManager';

// Error handlers
export { JavaScriptErrorHandler } from './handlers/JavaScriptErrorHandler';
export { PromiseRejectionHandler } from './handlers/PromiseRejectionHandler';
export { ReactErrorBoundary, useErrorBoundary, withErrorBoundary } from './handlers/ReactErrorBoundary';

// Error collector
export { ErrorCollector } from './collectors/ErrorCollector';

// Types
export type {
  ErrorSource,
  ErrorHandling,
  ErrorSeverity,
  ErrorEvent,
  ErrorTelemetryAttributes,
  ErrorConfig,
  ManualErrorOptions
} from './types/ErrorTypes';
