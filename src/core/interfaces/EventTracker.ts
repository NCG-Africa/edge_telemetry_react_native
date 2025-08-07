/**
 * EventTracker interface
 * Defines contract for tracking telemetry events
 */
export interface EventTracker {
  /**
   * Track a custom event with optional attributes
   */
  trackEvent(eventName: string, attributes?: Record<string, string>): void;
  
  /**
   * Track a metric with numeric value
   */
  trackMetric(metricName: string, value: number, attributes?: Record<string, string>): void;
  
  /**
   * Track an error or exception
   */
  trackError(error: Error, stackTrace?: string, attributes?: Record<string, string>): void;
  
  /**
   * Track screen/page navigation
   */
  trackScreen(screenName: string, attributes?: Record<string, string>): void;
  
  /**
   * Track network request
   */
  trackNetworkRequest(url: string, method: string, statusCode: number, duration: number, attributes?: Record<string, string>): void;
}
