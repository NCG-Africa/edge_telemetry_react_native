/**
 * TelemetrySession model - Must match Flutter SDK exactly
 * Represents a user session with device and app context
 */
export interface TelemetrySession {
  /** Unique session identifier */
  sessionId: string;
  
  /** Session start timestamp */
  startTime: Date;
  
  /** Session end timestamp (optional, set when session ends) */
  endTime?: Date;
  
  /** User identifier for this session */
  userId?: string;
  
  /** Device-specific attributes collected at session start */
  deviceAttributes: Record<string, string>;
  
  /** Application-specific attributes */
  appAttributes: Record<string, string>;
}

/**
 * Session statistics and metrics
 */
export interface SessionMetrics {
  /** Total duration of the session in milliseconds */
  duration?: number;
  
  /** Number of events recorded in this session */
  eventCount: number;
  
  /** Number of screens visited */
  screenCount: number;
  
  /** Number of errors encountered */
  errorCount: number;
  
  /** Number of network requests made */
  networkRequestCount: number;
}
