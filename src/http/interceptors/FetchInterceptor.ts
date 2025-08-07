import { HttpRequestTelemetry } from '../telemetry/HttpRequestTelemetry';
import type { HttpRequestTelemetryData } from '../telemetry/HttpRequestTelemetry';
import { TimingUtils } from '../utils/TimingUtils';
import { UrlUtils } from '../utils/UrlUtils';

/**
 * Fetch Interceptor for HTTP monitoring
 * Intercepts fetch requests and collects telemetry data
 */
export class FetchInterceptor {
  private static originalFetch: typeof fetch;
  private static isInstalled = false;
  private static onRequestComplete?: (telemetry: HttpRequestTelemetry) => void;
  private static ignoredUrls: string[] = [];
  private static ignoredDomains: string[] = [];
  private static maxUrlLength = 2048;
  
  /**
   * Install the fetch interceptor
   */
  static install(
    onRequestComplete: (telemetry: HttpRequestTelemetry) => void,
    options: {
      ignoredUrls?: string[];
      ignoredDomains?: string[];
      maxUrlLength?: number;
    } = {}
  ): void {
    if (this.isInstalled) {
      console.warn('FetchInterceptor: Already installed');
      return;
    }
    
    // Store original fetch
    this.originalFetch = global.fetch;
    this.onRequestComplete = onRequestComplete;
    this.ignoredUrls = options.ignoredUrls || [];
    this.ignoredDomains = options.ignoredDomains || [];
    this.maxUrlLength = options.maxUrlLength || 2048;
    
    // Install interceptor
    global.fetch = this.createInterceptedFetch();
    this.isInstalled = true;
    
    console.log('FetchInterceptor: Installed successfully');
  }
  
  /**
   * Uninstall the fetch interceptor
   */
  static uninstall(): void {
    if (!this.isInstalled) {
      console.warn('FetchInterceptor: Not installed');
      return;
    }
    
    // Restore original fetch
    global.fetch = this.originalFetch;
    this.isInstalled = false;
    this.onRequestComplete = undefined;
    
    console.log('FetchInterceptor: Uninstalled successfully');
  }
  
  /**
   * Check if interceptor is installed
   */
  static get installed(): boolean {
    return this.isInstalled;
  }
  
  /**
   * Create the intercepted fetch function
   */
  private static createInterceptedFetch(): typeof fetch {
    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = UrlUtils.extractUrlFromInput(input);
      
      // Check if URL should be ignored
      if (UrlUtils.shouldIgnoreUrl(url, this.ignoredUrls, this.ignoredDomains)) {
        return this.originalFetch(input, init);
      }
      
      const timer = TimingUtils.createTimer();
      const timestamp = new Date();
      const method = init?.method || 'GET';
      
      let requestSize: number | undefined;
      let response: Response;
      let error: string | undefined;
      
      try {
        // Calculate request size if body is present
        if (init?.body) {
          requestSize = this.calculateRequestSize(init.body);
        }
        
        // Make the actual request
        response = await this.originalFetch(input, init);
        
        // Create telemetry data for successful request
        const telemetryData: HttpRequestTelemetryData = {
          url: UrlUtils.sanitizeUrl(url, this.maxUrlLength),
          method,
          statusCode: response.status,
          duration: timer.stop(),
          timestamp,
          requestSize,
          responseSize: this.getResponseSize(response)
        };
        
        // Report telemetry
        if (this.onRequestComplete) {
          const telemetry = new HttpRequestTelemetry(telemetryData);
          this.onRequestComplete(telemetry);
        }
        
        return response;
        
      } catch (err) {
        // Handle network errors
        error = this.extractErrorMessage(err);
        
        const telemetryData: HttpRequestTelemetryData = {
          url: UrlUtils.sanitizeUrl(url, this.maxUrlLength),
          method,
          statusCode: 0, // Network error
          duration: timer.stop(),
          timestamp,
          error,
          requestSize
        };
        
        // Report error telemetry
        if (this.onRequestComplete) {
          const telemetry = new HttpRequestTelemetry(telemetryData);
          this.onRequestComplete(telemetry);
        }
        
        // Re-throw the error
        throw err;
      }
    };
  }
  
  /**
   * Calculate request body size
   */
  private static calculateRequestSize(body: any): number {
    if (typeof body === 'string') {
      return new Blob([body]).size;
    } else if (body instanceof ArrayBuffer) {
      return body.byteLength;
    } else if (body instanceof Uint8Array) {
      return body.byteLength;
    } else if (body instanceof FormData) {
      // FormData size is hard to calculate precisely
      return 0; // Will be estimated by browser
    } else if (body instanceof URLSearchParams) {
      return new Blob([body.toString()]).size;
    } else if (body instanceof Blob) {
      return body.size;
    }
    
    return 0;
  }
  
  /**
   * Get response size from headers
   */
  private static getResponseSize(response: Response): number | undefined {
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      const size = parseInt(contentLength, 10);
      return isNaN(size) ? undefined : size;
    }
    return undefined;
  }
  
  /**
   * Extract error message from caught exception
   */
  private static extractErrorMessage(error: any): string {
    if (error instanceof Error) {
      return error.message;
    } else if (typeof error === 'string') {
      return error;
    } else if (error && typeof error.toString === 'function') {
      return error.toString();
    } else {
      return 'Unknown network error';
    }
  }
  
  /**
   * Get interceptor statistics
   */
  static getStats(): {
    installed: boolean;
    ignoredUrlsCount: number;
    ignoredDomainsCount: number;
  } {
    return {
      installed: this.isInstalled,
      ignoredUrlsCount: this.ignoredUrls.length,
      ignoredDomainsCount: this.ignoredDomains.length
    };
  }
  
  /**
   * Update ignored URLs
   */
  static updateIgnoredUrls(urls: string[]): void {
    this.ignoredUrls = [...urls];
  }
  
  /**
   * Update ignored domains
   */
  static updateIgnoredDomains(domains: string[]): void {
    this.ignoredDomains = [...domains];
  }
}
