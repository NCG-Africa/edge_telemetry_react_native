/**
 * TelemetryEvent model - Must match Flutter SDK exactly
 * Represents a single telemetry event with all required metadata
 */
export interface TelemetryEvent {
  /** Unique identifier for this event */
  id: string;
  
  /** Session identifier this event belongs to */
  sessionId: string;
  
  /** Name/type of the event */
  eventName: string;
  
  /** Timestamp when the event occurred */
  timestamp: Date;
  
  /** Key-value attributes associated with the event */
  attributes: Record<string, string>;
  
  /** Optional user identifier */
  userId?: string;
}

/**
 * Metric event specifically for numeric measurements
 */
export interface TelemetryMetric extends TelemetryEvent {
  /** Numeric value of the metric */
  value: number;
  
  /** Unit of measurement (optional) */
  unit?: string;
}

/**
 * Error event for tracking exceptions and errors
 */
export interface TelemetryError extends TelemetryEvent {
  /** Error message */
  errorMessage: string;
  
  /** Stack trace if available */
  stackTrace?: string;
  
  /** Error type/class */
  errorType?: string;
}
