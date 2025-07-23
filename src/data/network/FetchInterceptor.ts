/**
 * Fetch Interceptor for Network Monitoring
 * 
 * This module provides functionality to monkey-patch the global fetch method
 * to capture network spans for telemetry purposes. This extends network monitoring
 * beyond what Embrace provides natively for libraries like Axios.
 * 
 * @future This is a placeholder for future implementation
 */

/**
 * Enables fetch interception for network monitoring
 * 
 * @future Implementation will monkey-patch the global fetch method to:
 * - Capture request details (URL, method, headers)
 * - Track response times and status codes
 * - Record network errors and timeouts
 * - Send telemetry data to the configured export URL
 * 
 * @param debugMode - Whether to enable debug logging for network interception
 */
export function enableFetchInterception(debugMode = false): void {
  // TODO: Implement fetch monkey-patching
  // This will intercept global fetch calls and wrap them with telemetry collection
  
  if (debugMode) {
    console.log('FetchInterceptor: Fetch interception not yet implemented');
  }
}

/**
 * Disables fetch interception and restores original fetch behavior
 * 
 * @future Implementation will restore the original fetch method
 */
export function disableFetchInterception(): void {
  // TODO: Implement restoration of original fetch method
}

/**
 * Configuration options for fetch interception
 * 
 * @future This interface will define options for customizing fetch interception behavior
 */
export interface FetchInterceptionConfig {
  /** Whether to capture request headers */
  captureHeaders?: boolean;
  /** Whether to capture request/response bodies */
  captureBodies?: boolean;
  /** Maximum body size to capture (in bytes) */
  maxBodySize?: number;
  /** URLs to exclude from monitoring (regex patterns) */
  excludeUrls?: RegExp[];
  /** Custom timeout for network requests (ms) */
  timeout?: number;
}

/**
 * Network span data structure for telemetry
 * 
 * @future This interface will define the structure of network telemetry data
 */
export interface NetworkSpan {
  /** Request URL */
  url: string;
  /** HTTP method */
  method: string;
  /** Request start timestamp */
  startTime: number;
  /** Request end timestamp */
  endTime: number;
  /** Response status code */
  statusCode?: number;
  /** Response status text */
  statusText?: string;
  /** Request headers (if captured) */
  requestHeaders?: Record<string, string>;
  /** Response headers (if captured) */
  responseHeaders?: Record<string, string>;
  /** Error information (if request failed) */
  error?: {
    message: string;
    type: string;
  };
}
