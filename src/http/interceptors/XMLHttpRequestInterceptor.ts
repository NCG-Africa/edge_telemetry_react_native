import { HttpRequestTelemetry } from '../telemetry/HttpRequestTelemetry';
import type { HttpRequestTelemetryData } from '../telemetry/HttpRequestTelemetry';
import { TimingUtils, Timer } from '../utils/TimingUtils';
import { UrlUtils } from '../utils/UrlUtils';

/**
 * XMLHttpRequest Interceptor for HTTP monitoring
 * Intercepts XMLHttpRequest and collects telemetry data
 */
export class XMLHttpRequestInterceptor {
  private static originalXMLHttpRequest: typeof XMLHttpRequest;
  private static isInstalled = false;
  private static onRequestComplete?: (telemetry: HttpRequestTelemetry) => void;
  private static ignoredUrls: string[] = [];
  private static ignoredDomains: string[] = [];
  private static maxUrlLength = 2048;
  
  /**
   * Install the XMLHttpRequest interceptor
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
      console.warn('XMLHttpRequestInterceptor: Already installed');
      return;
    }
    
    // Store original XMLHttpRequest
    this.originalXMLHttpRequest = global.XMLHttpRequest;
    this.onRequestComplete = onRequestComplete;
    this.ignoredUrls = options.ignoredUrls || [];
    this.ignoredDomains = options.ignoredDomains || [];
    this.maxUrlLength = options.maxUrlLength || 2048;
    
    // Install interceptor
    global.XMLHttpRequest = this.createInterceptedXMLHttpRequest();
    this.isInstalled = true;
    
    console.log('XMLHttpRequestInterceptor: Installed successfully');
  }
  
  /**
   * Uninstall the XMLHttpRequest interceptor
   */
  static uninstall(): void {
    if (!this.isInstalled) {
      console.warn('XMLHttpRequestInterceptor: Not installed');
      return;
    }
    
    // Restore original XMLHttpRequest
    global.XMLHttpRequest = this.originalXMLHttpRequest;
    this.isInstalled = false;
    this.onRequestComplete = undefined;
    
    console.log('XMLHttpRequestInterceptor: Uninstalled successfully');
  }
  
  /**
   * Check if interceptor is installed
   */
  static get installed(): boolean {
    return this.isInstalled;
  }
  
  /**
   * Create the intercepted XMLHttpRequest class
   */
  private static createInterceptedXMLHttpRequest(): typeof XMLHttpRequest {
    const OriginalXHR = this.originalXMLHttpRequest;
    const onRequestComplete = this.onRequestComplete;
    const ignoredUrls = this.ignoredUrls;
    const ignoredDomains = this.ignoredDomains;
    const maxUrlLength = this.maxUrlLength;
    
    return class InterceptedXMLHttpRequest extends OriginalXHR {
      private _url?: string;
      private _method?: string;
      private _timer?: Timer;
      private _timestamp?: Date;
      private _requestSize?: number;
      
      constructor() {
        super();
        this.setupInterception();
      }
      
      private setupInterception(): void {
        // Intercept open method
        const originalOpen = this.open;
        this.open = function(method: string, url: string | URL, async?: boolean, user?: string | null, password?: string | null): void {
          this._method = method.toUpperCase();
          this._url = typeof url === 'string' ? url : url.toString();
          this._timestamp = new Date();
          
          return originalOpen.call(this, method, url, async, user, password);
        };
        
        // Intercept send method
        const originalSend = this.send;
        this.send = function(body?: any): void {
          // Check if URL should be ignored
          if (this._url && UrlUtils.shouldIgnoreUrl(this._url, ignoredUrls, ignoredDomains)) {
            return originalSend.call(this, body);
          }
          
          this._timer = TimingUtils.createTimer();
          
          // Calculate request size
          if (body) {
            this._requestSize = XMLHttpRequestInterceptor.calculateRequestSize(body);
          }
          
          // Set up completion handler
          const handleCompletion = () => {
            if (this._url && this._method && this._timer && this._timestamp && onRequestComplete) {
              const duration = this._timer.stop();
              let error: string | undefined;
              let statusCode = this.status;
              
              // Handle network errors
              if (statusCode === 0 && this.readyState === XMLHttpRequest.DONE) {
                error = 'Network error';
              }
              
              const telemetryData: HttpRequestTelemetryData = {
                url: UrlUtils.sanitizeUrl(this._url, maxUrlLength),
                method: this._method,
                statusCode,
                duration,
                timestamp: this._timestamp,
                error,
                requestSize: this._requestSize,
                responseSize: XMLHttpRequestInterceptor.getResponseSize(this)
              };
              
              const telemetry = new HttpRequestTelemetry(telemetryData);
              onRequestComplete(telemetry);
            }
          };
          
          // Listen for completion
          this.addEventListener('loadend', handleCompletion);
          
          return originalSend.call(this, body);
        };
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
    } else if (body && typeof body === 'object' && body.nodeType) {
      // Handle Document-like objects in React Native environment
      try {
        const xmlString = String(body);
        return new Blob([xmlString]).size;
      } catch {
        return 0;
      }
    }
    
    return 0;
  }
  
  /**
   * Get response size from XMLHttpRequest
   */
  private static getResponseSize(xhr: XMLHttpRequest): number | undefined {
    // Try to get from Content-Length header
    const contentLength = xhr.getResponseHeader('content-length');
    if (contentLength) {
      const size = parseInt(contentLength, 10);
      if (!isNaN(size)) {
        return size;
      }
    }
    
    // Try to estimate from response text/data
    if (xhr.responseText) {
      return new Blob([xhr.responseText]).size;
    }
    
    if (xhr.response) {
      if (typeof xhr.response === 'string') {
        return new Blob([xhr.response]).size;
      } else if (xhr.response instanceof ArrayBuffer) {
        return xhr.response.byteLength;
      } else if (xhr.response instanceof Blob) {
        return xhr.response.size;
      }
    }
    
    return undefined;
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
