import { HttpRequestTelemetry } from '../telemetry/HttpRequestTelemetry';
import type { HttpRequestTelemetryData } from '../telemetry/HttpRequestTelemetry';
import { Duration } from '../utils/Duration';
import { TimingUtils } from '../utils/TimingUtils';
import { UrlUtils } from '../utils/UrlUtils';

/**
 * Axios request configuration with timing
 */
interface AxiosRequestConfigWithTiming {
  [key: string]: any;
  _telemetryStartTime?: number;
  _telemetryTimestamp?: Date;
}

/**
 * Axios Interceptor for HTTP monitoring
 * Intercepts Axios requests and collects telemetry data
 */
export class AxiosInterceptor {
  private static installedInstances: Set<any> = new Set();
  private static onRequestComplete?: (telemetry: HttpRequestTelemetry) => void;
  private static ignoredUrls: string[] = [];
  private static ignoredDomains: string[] = [];
  private static maxUrlLength = 2048;
  
  /**
   * Install interceptor on an Axios instance
   */
  static install(
    axiosInstance: any,
    onRequestComplete: (telemetry: HttpRequestTelemetry) => void,
    options: {
      ignoredUrls?: string[];
      ignoredDomains?: string[];
      maxUrlLength?: number;
    } = {}
  ): void {
    if (this.installedInstances.has(axiosInstance)) {
      console.warn('AxiosInterceptor: Already installed on this instance');
      return;
    }
    
    this.onRequestComplete = onRequestComplete;
    this.ignoredUrls = options.ignoredUrls || [];
    this.ignoredDomains = options.ignoredDomains || [];
    this.maxUrlLength = options.maxUrlLength || 2048;
    
    // Install request interceptor
    const requestInterceptorId = axiosInstance.interceptors.request.use(
      (config: AxiosRequestConfigWithTiming) => {
        const url = this.buildFullUrl(config);
        
        // Check if URL should be ignored
        if (UrlUtils.shouldIgnoreUrl(url, this.ignoredUrls, this.ignoredDomains)) {
          return config;
        }
        
        // Add timing metadata
        config._telemetryStartTime = TimingUtils.now();
        config._telemetryTimestamp = new Date();
        
        return config;
      },
      (error: any) => {
        return Promise.reject(error);
      }
    );
    
    // Install response interceptor
    const responseInterceptorId = axiosInstance.interceptors.response.use(
      (response: any) => {
        this.handleResponse(response);
        return response;
      },
      (error: any) => {
        this.handleError(error);
        return Promise.reject(error);
      }
    );
    
    // Store interceptor IDs for cleanup
    axiosInstance._telemetryInterceptors = {
      request: requestInterceptorId,
      response: responseInterceptorId
    };
    
    this.installedInstances.add(axiosInstance);
    console.log('AxiosInterceptor: Installed successfully');
  }
  
  /**
   * Uninstall interceptor from an Axios instance
   */
  static uninstall(axiosInstance: any): void {
    if (!this.installedInstances.has(axiosInstance)) {
      console.warn('AxiosInterceptor: Not installed on this instance');
      return;
    }
    
    if (axiosInstance._telemetryInterceptors) {
      // Remove interceptors
      axiosInstance.interceptors.request.eject(axiosInstance._telemetryInterceptors.request);
      axiosInstance.interceptors.response.eject(axiosInstance._telemetryInterceptors.response);
      
      // Clean up metadata
      delete axiosInstance._telemetryInterceptors;
    }
    
    this.installedInstances.delete(axiosInstance);
    console.log('AxiosInterceptor: Uninstalled successfully');
  }
  
  /**
   * Uninstall from all instances
   */
  static uninstallAll(): void {
    const instances = Array.from(this.installedInstances);
    instances.forEach(instance => this.uninstall(instance));
  }
  
  /**
   * Handle successful response
   */
  private static handleResponse(response: any): void {
    const config = response.config as AxiosRequestConfigWithTiming;
    
    if (!config._telemetryStartTime || !config._telemetryTimestamp) {
      return; // No timing data, probably ignored
    }
    
    const duration = new Duration(TimingUtils.now() - config._telemetryStartTime);
    const url = this.buildFullUrl(config);
    
    const telemetryData: HttpRequestTelemetryData = {
      url: UrlUtils.sanitizeUrl(url, this.maxUrlLength),
      method: (config.method || 'GET').toUpperCase(),
      statusCode: response.status,
      duration,
      timestamp: config._telemetryTimestamp,
      requestSize: this.calculateRequestSize(config),
      responseSize: this.calculateResponseSize(response)
    };
    
    if (this.onRequestComplete) {
      const telemetry = new HttpRequestTelemetry(telemetryData);
      this.onRequestComplete(telemetry);
    }
  }
  
  /**
   * Handle request error
   */
  private static handleError(error: any): void {
    const config = error.config as AxiosRequestConfigWithTiming;
    
    if (!config || !config._telemetryStartTime || !config._telemetryTimestamp) {
      return; // No timing data, probably ignored or no config
    }
    
    const duration = new Duration(TimingUtils.now() - config._telemetryStartTime);
    const url = this.buildFullUrl(config);
    
    let statusCode = 0;
    let errorMessage = 'Network error';
    let responseSize: number | undefined;
    
    if (error.response) {
      // Server responded with error status
      statusCode = error.response.status;
      errorMessage = `HTTP ${statusCode}`;
      responseSize = this.calculateResponseSize(error.response);
    } else if (error.request) {
      // Request was made but no response received
      errorMessage = 'No response received';
    } else {
      // Something else happened
      errorMessage = error.message || 'Unknown error';
    }
    
    const telemetryData: HttpRequestTelemetryData = {
      url: UrlUtils.sanitizeUrl(url, this.maxUrlLength),
      method: (config.method || 'GET').toUpperCase(),
      statusCode,
      duration,
      timestamp: config._telemetryTimestamp,
      error: errorMessage,
      requestSize: this.calculateRequestSize(config),
      responseSize
    };
    
    if (this.onRequestComplete) {
      const telemetry = new HttpRequestTelemetry(telemetryData);
      this.onRequestComplete(telemetry);
    }
  }
  
  /**
   * Build full URL from Axios config
   */
  private static buildFullUrl(config: any): string {
    let url = config.url || '';
    
    if (config.baseURL && !this.isAbsoluteUrl(url)) {
      url = config.baseURL.replace(/\/+$/, '') + '/' + url.replace(/^\/+/, '');
    }
    
    // Add query parameters
    if (config.params) {
      const params = new URLSearchParams();
      Object.keys(config.params).forEach(key => {
        params.append(key, config.params[key]);
      });
      const queryString = params.toString();
      if (queryString) {
        url += (url.includes('?') ? '&' : '?') + queryString;
      }
    }
    
    return url;
  }
  
  /**
   * Check if URL is absolute
   */
  private static isAbsoluteUrl(url: string): boolean {
    return /^https?:\/\//.test(url);
  }
  
  /**
   * Calculate request size from Axios config
   */
  private static calculateRequestSize(config: any): number | undefined {
    const data = config.data;
    
    if (!data) {
      return undefined;
    }
    
    if (typeof data === 'string') {
      return new Blob([data]).size;
    } else if (data instanceof ArrayBuffer) {
      return data.byteLength;
    } else if (data instanceof Uint8Array) {
      return data.byteLength;
    } else if (data instanceof FormData) {
      // FormData size is hard to calculate precisely
      return 0;
    } else if (data instanceof URLSearchParams) {
      return new Blob([data.toString()]).size;
    } else if (data instanceof Blob) {
      return data.size;
    } else if (typeof data === 'object') {
      // JSON object
      try {
        const jsonString = JSON.stringify(data);
        return new Blob([jsonString]).size;
      } catch {
        return 0;
      }
    }
    
    return 0;
  }
  
  /**
   * Calculate response size from Axios response
   */
  private static calculateResponseSize(response: any): number | undefined {
    // Try Content-Length header first
    const contentLength = response.headers?.['content-length'];
    if (contentLength) {
      const size = parseInt(contentLength, 10);
      if (!isNaN(size)) {
        return size;
      }
    }
    
    // Try to estimate from response data
    const data = response.data;
    if (!data) {
      return undefined;
    }
    
    if (typeof data === 'string') {
      return new Blob([data]).size;
    } else if (data instanceof ArrayBuffer) {
      return data.byteLength;
    } else if (data instanceof Blob) {
      return data.size;
    } else if (typeof data === 'object') {
      try {
        const jsonString = JSON.stringify(data);
        return new Blob([jsonString]).size;
      } catch {
        return undefined;
      }
    }
    
    return undefined;
  }
  
  /**
   * Get interceptor statistics
   */
  static getStats(): {
    installedInstancesCount: number;
    ignoredUrlsCount: number;
    ignoredDomainsCount: number;
  } {
    return {
      installedInstancesCount: this.installedInstances.size,
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
