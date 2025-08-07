import { Duration } from '../utils/Duration';

/**
 * HTTP Request Telemetry Data Interface
 * Defines the structure for HTTP request telemetry data
 */
export interface HttpRequestTelemetryData {
  url: string;
  method: string;
  statusCode: number;
  duration: Duration;
  timestamp: Date;
  error?: string;
  responseSize?: number;
  requestSize?: number;
}

/**
 * HttpRequestTelemetry - Must produce identical telemetry data structures as Flutter's TelemetryHttpOverrides
 * 
 * CRITICAL: This class must match Flutter SDK's HttpRequestTelemetry exactly for backend compatibility
 */
export class HttpRequestTelemetry {
  readonly url: string;
  readonly method: string;
  readonly statusCode: number;
  readonly duration: Duration;
  readonly timestamp: Date;
  readonly error?: string;
  readonly responseSize?: number;
  readonly requestSize?: number;
  
  constructor(data: HttpRequestTelemetryData) {
    this.url = data.url;
    this.method = data.method.toUpperCase();
    this.statusCode = data.statusCode;
    this.duration = data.duration;
    this.timestamp = data.timestamp;
    this.error = data.error;
    this.responseSize = data.responseSize;
    this.requestSize = data.requestSize;
  }
  
  /**
   * Convert to attributes for telemetry events
   * CRITICAL: Must match Flutter's exact attribute structure
   */
  toAttributes(): Record<string, string> {
    const attributes: Record<string, string> = {
      'http.url': this.url,
      'http.method': this.method,
      'http.status_code': this.statusCode.toString(),
      'http.duration_ms': this.duration.inMilliseconds.toString(),
      'http.timestamp': this.timestamp.toISOString(),
      'http.success': this.isSuccess.toString(),
      'http.category': this.category,
      'http.performance': this.performanceCategory,
    };
    
    // Add optional attributes
    if (this.error) {
      attributes['http.error'] = this.error;
    }
    
    if (this.responseSize !== undefined) {
      attributes['http.response_size'] = this.responseSize.toString();
    }
    
    if (this.requestSize !== undefined) {
      attributes['http.request_size'] = this.requestSize.toString();
    }
    
    return attributes;
  }
  
  /**
   * Get HTTP response category
   * Must match Flutter's exact categorization logic
   */
  get category(): 'success' | 'redirect' | 'client_error' | 'server_error' | 'network_error' {
    if (this.error) return 'network_error';
    if (this.statusCode >= 200 && this.statusCode < 300) return 'success';
    if (this.statusCode >= 300 && this.statusCode < 400) return 'redirect';
    if (this.statusCode >= 400 && this.statusCode < 500) return 'client_error';
    if (this.statusCode >= 500) return 'server_error';
    return 'network_error'; // Fallback for unknown status codes
  }
  
  /**
   * Determine if request was successful
   * Must match Flutter's success determination logic
   */
  get isSuccess(): boolean {
    return this.statusCode >= 200 && this.statusCode < 400 && !this.error;
  }
  
  /**
   * Get performance category based on response time
   * Must match Flutter's exact timing thresholds
   */
  get performanceCategory(): 'fast' | 'normal' | 'slow' | 'very_slow' {
    const ms = this.duration.inMilliseconds;
    if (ms < 100) return 'fast';
    if (ms < 500) return 'normal';
    if (ms < 2000) return 'slow';
    return 'very_slow';
  }
  
  /**
   * Get a human-readable summary of the request
   */
  getSummary(): string {
    const emoji = this.isSuccess ? '✅' : '❌';
    const timing = `(${this.duration.inMilliseconds}ms)`;
    const category = `[${this.performanceCategory.toUpperCase()}]`;
    
    return `${emoji} HTTP ${this.method} ${this.url} - ${this.statusCode} ${timing} ${category}`;
  }
  
  /**
   * Check if this is a slow request (>2000ms)
   */
  get isSlowRequest(): boolean {
    return this.duration.inMilliseconds > 2000;
  }
  
  /**
   * Check if this is an error request
   */
  get isErrorRequest(): boolean {
    return !this.isSuccess;
  }
  
  /**
   * Get the domain from the URL
   */
  get domain(): string {
    try {
      const url = new URL(this.url);
      return url.hostname;
    } catch {
      return 'unknown';
    }
  }
  
  /**
   * Get the path from the URL (without query parameters)
   */
  get path(): string {
    try {
      const url = new URL(this.url);
      return url.pathname;
    } catch {
      return this.url;
    }
  }
}
