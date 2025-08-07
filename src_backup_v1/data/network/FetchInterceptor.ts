/**
 * Fetch Interceptor for Network Monitoring
 * 
 * This module provides functionality to monkey-patch the global fetch method
 * to capture network spans for telemetry purposes. This extends network monitoring
 * beyond what Embrace provides natively for libraries like Axios.
 */

import { EdgeTelemetry } from '../../core/EdgeTelemetry';

// Type declarations for fetch API
declare const global: any;
type RequestInfo = string | URL | Request;

// Store reference to original fetch function
let originalFetch: typeof fetch | null = null;

/**
 * Intercepts the global fetch function to enable network request tracking
 */
export function interceptFetch(): void {
  // Check if global.fetch is available
  if (typeof global !== 'undefined' && global.fetch) {
    // Store the original fetch function
    originalFetch = global.fetch;
    
    // Replace global.fetch with wrapper function
    global.fetch = function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const startTime = Date.now();
      
      // Extract request details for telemetry
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method || 'GET';
      
      // Call original fetch with the same arguments
      const fetchPromise = originalFetch!(input, init);
      
      // Handle response and track telemetry
      return fetchPromise
        .then((response) => {
          const endTime = Date.now();
          const duration = endTime - startTime;
          
          // Track successful network request
          EdgeTelemetry.trackEvent({
            type: 'network.request',
            url,
            method,
            status: response.status,
            statusText: response.statusText,
            duration,
            timestamp: new Date(startTime).toISOString(),
            source: 'internal'
          });
          
          return response;
        })
        .catch((error) => {
          const endTime = Date.now();
          const duration = endTime - startTime;
          
          // Track failed network request
          EdgeTelemetry.trackEvent({
            type: 'network.request',
            url,
            method,
            status: 0,
            error: error.message || 'Network request failed',
            duration,
            timestamp: new Date(startTime).toISOString(),
            source: 'internal'
          });
          
          throw error;
        });
    };
  }
}
