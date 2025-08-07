import { Duration } from '../utils/Duration';
import { HttpRequestTelemetry } from '../telemetry/HttpRequestTelemetry';

/**
 * HTTP Metrics Tracker
 * Tracks and aggregates HTTP performance metrics
 */
export class HttpMetricsTracker {
  private readonly metrics: Map<string, HttpDomainMetrics> = new Map();
  private readonly globalMetrics: HttpGlobalMetrics;
  private readonly maxDomains: number;
  
  constructor(maxDomains: number = 100) {
    this.maxDomains = maxDomains;
    this.globalMetrics = new HttpGlobalMetrics();
  }
  
  /**
   * Track HTTP request metrics
   */
  trackRequest(httpTelemetry: HttpRequestTelemetry): void {
    const domain = httpTelemetry.domain;
    
    // Update global metrics
    this.globalMetrics.addRequest(httpTelemetry);
    
    // Update domain-specific metrics
    if (!this.metrics.has(domain)) {
      // Check if we've reached the max domains limit
      if (this.metrics.size >= this.maxDomains) {
        // Remove the least recently used domain
        const oldestDomain = this.findOldestDomain();
        if (oldestDomain) {
          this.metrics.delete(oldestDomain);
        }
      }
      
      this.metrics.set(domain, new HttpDomainMetrics(domain));
    }
    
    const domainMetrics = this.metrics.get(domain)!;
    domainMetrics.addRequest(httpTelemetry);
  }
  
  /**
   * Get metrics for a specific domain
   */
  getDomainMetrics(domain: string): HttpDomainMetrics | undefined {
    return this.metrics.get(domain);
  }
  
  /**
   * Get global HTTP metrics
   */
  getGlobalMetrics(): HttpGlobalMetrics {
    return this.globalMetrics;
  }
  
  /**
   * Get all domain metrics
   */
  getAllDomainMetrics(): Map<string, HttpDomainMetrics> {
    return new Map(this.metrics);
  }
  
  /**
   * Get top domains by request count
   */
  getTopDomains(limit: number = 10): Array<{ domain: string; metrics: HttpDomainMetrics }> {
    return Array.from(this.metrics.entries())
      .map(([domain, metrics]) => ({ domain, metrics }))
      .sort((a, b) => b.metrics.totalRequests - a.metrics.totalRequests)
      .slice(0, limit);
  }
  
  /**
   * Get slowest domains
   */
  getSlowestDomains(limit: number = 10): Array<{ domain: string; metrics: HttpDomainMetrics }> {
    return Array.from(this.metrics.entries())
      .map(([domain, metrics]) => ({ domain, metrics }))
      .sort((a, b) => b.metrics.averageResponseTime.inMilliseconds - a.metrics.averageResponseTime.inMilliseconds)
      .slice(0, limit);
  }
  
  /**
   * Get domains with highest error rates
   */
  getHighestErrorRateDomains(limit: number = 10): Array<{ domain: string; metrics: HttpDomainMetrics }> {
    return Array.from(this.metrics.entries())
      .map(([domain, metrics]) => ({ domain, metrics }))
      .filter(({ metrics }) => metrics.totalRequests > 0)
      .sort((a, b) => b.metrics.errorRate - a.metrics.errorRate)
      .slice(0, limit);
  }
  
  /**
   * Reset all metrics
   */
  reset(): void {
    this.metrics.clear();
    this.globalMetrics.reset();
  }
  
  /**
   * Get metrics summary for telemetry
   */
  getMetricsSummary(): Record<string, any> {
    const global = this.globalMetrics;
    
    return {
      'http.total_requests': global.totalRequests,
      'http.successful_requests': global.successfulRequests,
      'http.failed_requests': global.failedRequests,
      'http.error_rate': global.errorRate,
      'http.average_response_time_ms': global.averageResponseTime.inMilliseconds,
      'http.slowest_request_ms': global.slowestRequest.inMilliseconds,
      'http.fastest_request_ms': global.fastestRequest.inMilliseconds,
      'http.domains_count': this.metrics.size,
      'http.bytes_sent': global.totalBytesSent,
      'http.bytes_received': global.totalBytesReceived
    };
  }
  
  /**
   * Find the oldest domain (least recently updated)
   */
  private findOldestDomain(): string | undefined {
    let oldestDomain: string | undefined;
    let oldestTime = Date.now();
    
    for (const [domain, metrics] of this.metrics) {
      if (metrics.lastRequestTime < oldestTime) {
        oldestTime = metrics.lastRequestTime;
        oldestDomain = domain;
      }
    }
    
    return oldestDomain;
  }
}

/**
 * Global HTTP metrics aggregator
 */
export class HttpGlobalMetrics {
  totalRequests = 0;
  successfulRequests = 0;
  failedRequests = 0;
  totalResponseTime = 0;
  slowestRequest = new Duration(0);
  fastestRequest = new Duration(Number.MAX_SAFE_INTEGER);
  totalBytesSent = 0;
  totalBytesReceived = 0;
  
  addRequest(httpTelemetry: HttpRequestTelemetry): void {
    this.totalRequests++;
    
    if (httpTelemetry.isSuccess) {
      this.successfulRequests++;
    } else {
      this.failedRequests++;
    }
    
    // Update timing metrics
    const duration = httpTelemetry.duration.inMilliseconds;
    this.totalResponseTime += duration;
    
    if (httpTelemetry.duration.isLongerThan(this.slowestRequest)) {
      this.slowestRequest = httpTelemetry.duration;
    }
    
    if (httpTelemetry.duration.isShorterThan(this.fastestRequest)) {
      this.fastestRequest = httpTelemetry.duration;
    }
    
    // Update byte metrics
    if (httpTelemetry.requestSize) {
      this.totalBytesSent += httpTelemetry.requestSize;
    }
    
    if (httpTelemetry.responseSize) {
      this.totalBytesReceived += httpTelemetry.responseSize;
    }
  }
  
  get errorRate(): number {
    return this.totalRequests > 0 ? this.failedRequests / this.totalRequests : 0;
  }
  
  get averageResponseTime(): Duration {
    return this.totalRequests > 0 
      ? new Duration(this.totalResponseTime / this.totalRequests)
      : new Duration(0);
  }
  
  reset(): void {
    this.totalRequests = 0;
    this.successfulRequests = 0;
    this.failedRequests = 0;
    this.totalResponseTime = 0;
    this.slowestRequest = new Duration(0);
    this.fastestRequest = new Duration(Number.MAX_SAFE_INTEGER);
    this.totalBytesSent = 0;
    this.totalBytesReceived = 0;
  }
}

/**
 * Domain-specific HTTP metrics
 */
export class HttpDomainMetrics {
  readonly domain: string;
  totalRequests = 0;
  successfulRequests = 0;
  failedRequests = 0;
  totalResponseTime = 0;
  slowestRequest = new Duration(0);
  fastestRequest = new Duration(Number.MAX_SAFE_INTEGER);
  totalBytesSent = 0;
  totalBytesReceived = 0;
  lastRequestTime = Date.now();
  
  constructor(domain: string) {
    this.domain = domain;
  }
  
  addRequest(httpTelemetry: HttpRequestTelemetry): void {
    this.totalRequests++;
    this.lastRequestTime = Date.now();
    
    if (httpTelemetry.isSuccess) {
      this.successfulRequests++;
    } else {
      this.failedRequests++;
    }
    
    // Update timing metrics
    const duration = httpTelemetry.duration.inMilliseconds;
    this.totalResponseTime += duration;
    
    if (httpTelemetry.duration.isLongerThan(this.slowestRequest)) {
      this.slowestRequest = httpTelemetry.duration;
    }
    
    if (httpTelemetry.duration.isShorterThan(this.fastestRequest)) {
      this.fastestRequest = httpTelemetry.duration;
    }
    
    // Update byte metrics
    if (httpTelemetry.requestSize) {
      this.totalBytesSent += httpTelemetry.requestSize;
    }
    
    if (httpTelemetry.responseSize) {
      this.totalBytesReceived += httpTelemetry.responseSize;
    }
  }
  
  get errorRate(): number {
    return this.totalRequests > 0 ? this.failedRequests / this.totalRequests : 0;
  }
  
  get averageResponseTime(): Duration {
    return this.totalRequests > 0 
      ? new Duration(this.totalResponseTime / this.totalRequests)
      : new Duration(0);
  }
}
