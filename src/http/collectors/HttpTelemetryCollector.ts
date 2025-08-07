import type { TelemetryEvent } from '../../core/models/TelemetryEvent';
import { HttpRequestTelemetry } from '../telemetry/HttpRequestTelemetry';
import { NetworkUtils } from '../utils/NetworkUtils';

/**
 * HTTP Telemetry Collector
 * Processes HTTP request telemetry and converts to TelemetryEvent format
 */
export class HttpTelemetryCollector {
  private readonly enabledCategories: Set<string>;
  private readonly maxEventsPerBatch: number;
  private readonly eventBuffer: TelemetryEvent[] = [];
  
  constructor(
    enabledCategories: string[] = ['http_request', 'http_error', 'http_performance'],
    maxEventsPerBatch: number = 50
  ) {
    this.enabledCategories = new Set(enabledCategories);
    this.maxEventsPerBatch = maxEventsPerBatch;
  }
  
  /**
   * Process HTTP request telemetry and create telemetry events
   */
  processHttpRequest(httpTelemetry: HttpRequestTelemetry): TelemetryEvent[] {
    const events: TelemetryEvent[] = [];
    
    // Always create base HTTP request event
    if (this.enabledCategories.has('http_request')) {
      events.push(this.createHttpRequestEvent(httpTelemetry));
    }
    
    // Create error event for failed requests
    if (this.enabledCategories.has('http_error') && httpTelemetry.isErrorRequest) {
      events.push(this.createHttpErrorEvent(httpTelemetry));
    }
    
    // Create performance event for slow requests
    if (this.enabledCategories.has('http_performance') && httpTelemetry.isSlowRequest) {
      events.push(this.createHttpPerformanceEvent(httpTelemetry));
    }
    
    return events;
  }
  
  /**
   * Create base HTTP request telemetry event
   */
  private createHttpRequestEvent(httpTelemetry: HttpRequestTelemetry): TelemetryEvent {
    const networkAttributes = NetworkUtils.getNetworkAttributes();
    
    return {
      id: this.generateEventId(),
      type: 'http_request',
      timestamp: httpTelemetry.timestamp,
      attributes: {
        ...httpTelemetry.toAttributes(),
        ...networkAttributes,
        'event.category': 'http',
        'event.action': 'request',
        'event.outcome': httpTelemetry.isSuccess ? 'success' : 'failure'
      },
      metrics: {
        'http.duration': httpTelemetry.duration.inMilliseconds,
        'http.response_size': httpTelemetry.responseSize || 0,
        'http.request_size': httpTelemetry.requestSize || 0
      }
    };
  }
  
  /**
   * Create HTTP error telemetry event
   */
  private createHttpErrorEvent(httpTelemetry: HttpRequestTelemetry): TelemetryEvent {
    const networkAttributes = NetworkUtils.getNetworkAttributes();
    
    return {
      id: this.generateEventId(),
      type: 'http_error',
      timestamp: httpTelemetry.timestamp,
      attributes: {
        ...httpTelemetry.toAttributes(),
        ...networkAttributes,
        'event.category': 'error',
        'event.action': 'http_request_failed',
        'error.type': httpTelemetry.category,
        'error.message': httpTelemetry.error || `HTTP ${httpTelemetry.statusCode}`,
        'error.stack': '', // Not available for HTTP errors
        'severity': this.getErrorSeverity(httpTelemetry)
      },
      metrics: {
        'http.duration': httpTelemetry.duration.inMilliseconds,
        'error.count': 1
      }
    };
  }
  
  /**
   * Create HTTP performance telemetry event
   */
  private createHttpPerformanceEvent(httpTelemetry: HttpRequestTelemetry): TelemetryEvent {
    const networkAttributes = NetworkUtils.getNetworkAttributes();
    
    return {
      id: this.generateEventId(),
      type: 'http_performance',
      timestamp: httpTelemetry.timestamp,
      attributes: {
        ...httpTelemetry.toAttributes(),
        ...networkAttributes,
        'event.category': 'performance',
        'event.action': 'slow_http_request',
        'performance.issue': 'slow_response',
        'performance.threshold_ms': '2000'
      },
      metrics: {
        'http.duration': httpTelemetry.duration.inMilliseconds,
        'performance.slowness_factor': httpTelemetry.duration.inMilliseconds / 2000
      }
    };
  }
  
  /**
   * Get error severity based on HTTP status and error type
   */
  private getErrorSeverity(httpTelemetry: HttpRequestTelemetry): string {
    if (httpTelemetry.error) {
      return 'error'; // Network errors are always errors
    }
    
    if (httpTelemetry.statusCode >= 500) {
      return 'error'; // Server errors
    }
    
    if (httpTelemetry.statusCode >= 400) {
      return 'warning'; // Client errors
    }
    
    return 'info';
  }
  
  /**
   * Generate unique event ID
   */
  private generateEventId(): string {
    return `http_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Add events to buffer for batch processing
   */
  addToBuffer(events: TelemetryEvent[]): void {
    this.eventBuffer.push(...events);
  }
  
  /**
   * Flush buffered events and return them
   */
  flushBuffer(): TelemetryEvent[] {
    const events = this.eventBuffer.splice(0, this.maxEventsPerBatch);
    return events;
  }
  
  /**
   * Get current buffer size
   */
  getBufferSize(): number {
    return this.eventBuffer.length;
  }
  
  /**
   * Check if buffer should be flushed
   */
  shouldFlushBuffer(): boolean {
    return this.eventBuffer.length >= this.maxEventsPerBatch;
  }
  
  /**
   * Clear all buffered events
   */
  clearBuffer(): void {
    this.eventBuffer.length = 0;
  }
  
  /**
   * Get HTTP request summary for debugging
   */
  getHttpSummary(httpTelemetry: HttpRequestTelemetry): string {
    return httpTelemetry.getSummary();
  }
}
