import { FetchInterceptor } from './interceptors/FetchInterceptor';
import { XMLHttpRequestInterceptor } from './interceptors/XMLHttpRequestInterceptor';
import { AxiosInterceptor } from './interceptors/AxiosInterceptor';
import { HttpTelemetryCollector } from './collectors/HttpTelemetryCollector';
import { HttpMetricsTracker } from './collectors/HttpMetricsTracker';
import { HttpRequestTelemetry } from './telemetry/HttpRequestTelemetry';
import { NetworkUtils } from './utils/NetworkUtils';
import type { TelemetryEvent } from '../core/models/TelemetryEvent';
import type { TelemetryConfig } from '../core/config/TelemetryConfig';

/**
 * Network Monitor Manager
 * Coordinates all HTTP monitoring components and provides unified interface
 */
export class NetworkMonitorManager {
  private readonly telemetryCollector: HttpTelemetryCollector;
  private readonly metricsTracker: HttpMetricsTracker;
  private readonly config: TelemetryConfig;
  private isInitialized = false;
  private onTelemetryEvent?: (events: TelemetryEvent[]) => void;
  
  constructor(config: TelemetryConfig) {
    this.config = config;
    this.telemetryCollector = new HttpTelemetryCollector(
      this.getEnabledCategories(),
      config.batchSize || 50
    );
    this.metricsTracker = new HttpMetricsTracker(100); // Max 100 domains
  }
  
  /**
   * Initialize HTTP monitoring
   */
  async initialize(onTelemetryEvent: (events: TelemetryEvent[]) => void): Promise<void> {
    if (this.isInitialized) {
      console.warn('NetworkMonitorManager: Already initialized');
      return;
    }
    
    this.onTelemetryEvent = onTelemetryEvent;
    
    try {
      // Initialize network utilities
      await NetworkUtils.initialize();
      
      // Install interceptors if HTTP monitoring is enabled
      if (this.config.httpMonitoring) {
        this.installInterceptors();
      }
      
      this.isInitialized = true;
      console.log('NetworkMonitorManager: Initialized successfully');
      
    } catch (error) {
      console.error('NetworkMonitorManager: Failed to initialize:', error);
      throw error;
    }
  }
  
  /**
   * Shutdown HTTP monitoring
   */
  shutdown(): void {
    if (!this.isInitialized) {
      console.warn('NetworkMonitorManager: Not initialized');
      return;
    }
    
    try {
      // Uninstall interceptors
      this.uninstallInterceptors();
      
      // Flush any remaining telemetry
      this.flushTelemetry();
      
      this.isInitialized = false;
      console.log('NetworkMonitorManager: Shutdown successfully');
      
    } catch (error) {
      console.error('NetworkMonitorManager: Error during shutdown:', error);
    }
  }
  
  /**
   * Install HTTP interceptors
   */
  private installInterceptors(): void {
    const options = {
      ignoredUrls: this.config.httpIgnoredUrls || [],
      ignoredDomains: this.config.httpIgnoredDomains || [],
      maxUrlLength: 2048
    };
    
    // Install fetch interceptor
    FetchInterceptor.install(
      (telemetry) => this.handleHttpRequest(telemetry),
      options
    );
    
    // Install XMLHttpRequest interceptor
    XMLHttpRequestInterceptor.install(
      (telemetry) => this.handleHttpRequest(telemetry),
      options
    );
    
    console.log('NetworkMonitorManager: HTTP interceptors installed');
  }
  
  /**
   * Uninstall HTTP interceptors
   */
  private uninstallInterceptors(): void {
    FetchInterceptor.uninstall();
    XMLHttpRequestInterceptor.uninstall();
    AxiosInterceptor.uninstallAll();
    
    console.log('NetworkMonitorManager: HTTP interceptors uninstalled');
  }
  
  /**
   * Install Axios interceptor on specific instance
   */
  installAxiosInterceptor(axiosInstance: any): void {
    if (!this.isInitialized) {
      console.warn('NetworkMonitorManager: Not initialized, cannot install Axios interceptor');
      return;
    }
    
    const options = {
      ignoredUrls: this.config.httpIgnoredUrls || [],
      ignoredDomains: this.config.httpIgnoredDomains || [],
      maxUrlLength: 2048
    };
    
    AxiosInterceptor.install(
      axiosInstance,
      (telemetry) => this.handleHttpRequest(telemetry),
      options
    );
    
    console.log('NetworkMonitorManager: Axios interceptor installed on instance');
  }
  
  /**
   * Handle HTTP request telemetry
   */
  private handleHttpRequest(httpTelemetry: HttpRequestTelemetry): void {
    try {
      // Track metrics
      this.metricsTracker.trackRequest(httpTelemetry);
      
      // Process telemetry events
      const events = this.telemetryCollector.processHttpRequest(httpTelemetry);
      
      // Add to buffer
      this.telemetryCollector.addToBuffer(events);
      
      // Debug logging
      if (this.config.debug) {
        console.log('NetworkMonitorManager: HTTP Request:', this.telemetryCollector.getHttpSummary(httpTelemetry));
      }
      
      // Flush if buffer is full
      if (this.telemetryCollector.shouldFlushBuffer()) {
        this.flushTelemetry();
      }
      
    } catch (error) {
      console.error('NetworkMonitorManager: Error handling HTTP request:', error);
    }
  }
  
  /**
   * Flush telemetry events
   */
  private flushTelemetry(): void {
    if (!this.onTelemetryEvent) {
      return;
    }
    
    const events = this.telemetryCollector.flushBuffer();
    if (events.length > 0) {
      this.onTelemetryEvent(events);
      
      if (this.config.debug) {
        console.log(`NetworkMonitorManager: Flushed ${events.length} HTTP telemetry events`);
      }
    }
  }
  
  /**
   * Get enabled telemetry categories
   */
  private getEnabledCategories(): string[] {
    const categories: string[] = [];
    
    if (this.config.httpMonitoring) {
      categories.push('http_request');
    }
    
    if (this.config.performanceMonitoring) {
      categories.push('http_performance');
    }
    
    // Always include error tracking if HTTP monitoring is enabled
    if (this.config.httpMonitoring) {
      categories.push('http_error');
    }
    
    return categories;
  }
  
  /**
   * Get HTTP metrics summary
   */
  getMetricsSummary(): Record<string, any> {
    return this.metricsTracker.getMetricsSummary();
  }
  
  /**
   * Get global HTTP metrics
   */
  getGlobalMetrics() {
    return this.metricsTracker.getGlobalMetrics();
  }
  
  /**
   * Get domain-specific metrics
   */
  getDomainMetrics(domain: string) {
    return this.metricsTracker.getDomainMetrics(domain);
  }
  
  /**
   * Get top domains by request count
   */
  getTopDomains(limit: number = 10) {
    return this.metricsTracker.getTopDomains(limit);
  }
  
  /**
   * Get slowest domains
   */
  getSlowestDomains(limit: number = 10) {
    return this.metricsTracker.getSlowestDomains(limit);
  }
  
  /**
   * Get domains with highest error rates
   */
  getHighestErrorRateDomains(limit: number = 10) {
    return this.metricsTracker.getHighestErrorRateDomains(limit);
  }
  
  /**
   * Reset all metrics
   */
  resetMetrics(): void {
    this.metricsTracker.reset();
    this.telemetryCollector.clearBuffer();
    
    if (this.config.debug) {
      console.log('NetworkMonitorManager: Metrics reset');
    }
  }
  
  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<TelemetryConfig>): void {
    Object.assign(this.config, newConfig);
    
    // Update interceptor ignore lists
    if (newConfig.httpIgnoredUrls || newConfig.httpIgnoredDomains) {
      FetchInterceptor.updateIgnoredUrls(this.config.httpIgnoredUrls || []);
      FetchInterceptor.updateIgnoredDomains(this.config.httpIgnoredDomains || []);
      
      XMLHttpRequestInterceptor.updateIgnoredUrls(this.config.httpIgnoredUrls || []);
      XMLHttpRequestInterceptor.updateIgnoredDomains(this.config.httpIgnoredDomains || []);
      
      AxiosInterceptor.updateIgnoredUrls(this.config.httpIgnoredUrls || []);
      AxiosInterceptor.updateIgnoredDomains(this.config.httpIgnoredDomains || []);
    }
    
    if (this.config.debug) {
      console.log('NetworkMonitorManager: Configuration updated');
    }
  }
  
  /**
   * Get current network information
   */
  getCurrentNetworkInfo() {
    return NetworkUtils.getCurrentNetworkInfo();
  }
  
  /**
   * Check if network is suitable for telemetry upload
   */
  isSuitableForUpload(): boolean {
    return NetworkUtils.isSuitableForUpload();
  }
  
  /**
   * Get interceptor statistics
   */
  getInterceptorStats() {
    return {
      fetch: FetchInterceptor.getStats(),
      xhr: XMLHttpRequestInterceptor.getStats(),
      axios: AxiosInterceptor.getStats()
    };
  }
  
  /**
   * Get manager status
   */
  getStatus() {
    return {
      initialized: this.isInitialized,
      httpMonitoring: this.config.httpMonitoring,
      bufferSize: this.telemetryCollector.getBufferSize(),
      networkInfo: this.getCurrentNetworkInfo(),
      interceptors: this.getInterceptorStats(),
      metrics: this.getMetricsSummary()
    };
  }
}
