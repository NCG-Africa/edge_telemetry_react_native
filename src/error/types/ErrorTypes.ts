/**
 * Error types matching Flutter SDK exactly for backend compatibility
 */

/**
 * Error sources - must match Flutter's error classification
 */
export type ErrorSource = 
  | 'javascript'
  | 'promise_rejection'
  | 'react_component'
  | 'native'
  | 'manual';

/**
 * Error handling classification
 */
export type ErrorHandling = 
  | 'handled'
  | 'unhandled';

/**
 * Error severity levels
 */
export type ErrorSeverity = 
  | 'fatal'
  | 'non_fatal';

/**
 * Error event structure - must match Flutter exactly
 */
export interface ErrorEvent {
  type: ErrorSource;
  message: string;
  timestamp: number;
  hasStackTrace: boolean;
  stackTrace?: string;
  handling: ErrorHandling;
  severity: ErrorSeverity;
  errorClass?: string;
  context?: Record<string, any>;
}

/**
 * Error telemetry attributes - must match Flutter exactly
 */
export interface ErrorTelemetryAttributes {
  'error.type': ErrorSource;
  'error.message': string;
  'error.timestamp': string;
  'error.has_stack_trace': string;
  'error.stack_trace'?: string;
  'error.handling': ErrorHandling;
  'error.severity': ErrorSeverity;
  'error.class'?: string;
  'error.context'?: string;
}

/**
 * Error configuration options
 */
export interface ErrorConfig {
  enableJavaScriptErrors: boolean;
  enablePromiseRejections: boolean;
  enableReactErrors: boolean;
  enableNativeErrors: boolean;
  captureStackTraces: boolean;
  maxStackTraceLength: number;
  debugMode: boolean;
}

/**
 * Manual error tracking options
 */
export interface ManualErrorOptions {
  message: string;
  stackTrace?: string;
  errorClass?: string;
  context?: Record<string, any>;
  severity?: ErrorSeverity;
  handling?: ErrorHandling;
}
