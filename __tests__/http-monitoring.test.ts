import { EdgeTelemetry } from '../src/EdgeTelemetry';
import {
  NetworkMonitorManager,
  HttpRequestTelemetry,
  HttpTelemetryCollector,
  HttpMetricsTracker,
  FetchInterceptor,
  XMLHttpRequestInterceptor,
  Duration,
  TimingUtils,
  UrlUtils,
  NetworkUtils
} from '../src/http';
import type { TelemetryInitConfig } from '../src/core/config/TelemetryConfig';

// Mock fetch for testing
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock XMLHttpRequest
const mockXHR = {
  open: jest.fn(),
  send: jest.fn(),
  setRequestHeader: jest.fn(),
  addEventListener: jest.fn(),
  status: 200,
  readyState: 4,
  response: 'test response',
  getResponseHeader: jest.fn()
};
global.XMLHttpRequest = jest.fn(() => mockXHR) as any;

describe('Phase 7: HTTP Monitoring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset interceptors
    if (FetchInterceptor.installed) {
      FetchInterceptor.uninstall();
    }
    if (XMLHttpRequestInterceptor.installed) {
      XMLHttpRequestInterceptor.uninstall();
    }
  });

  describe('Duration Utility', () => {
    test('should create duration from milliseconds', () => {
      const duration = new Duration(1500);
      expect(duration.inMilliseconds).toBe(1500);
      expect(duration.inSeconds).toBe(1.5);
      expect(duration.inMicroseconds).toBe(1500000);
    });

    test('should create duration from seconds', () => {
      const duration = Duration.fromSeconds(2.5);
      expect(duration.inMilliseconds).toBe(2500);
      expect(duration.inSeconds).toBe(2.5);
    });

    test('should compare durations correctly', () => {
      const duration1 = new Duration(1000);
      const duration2 = new Duration(2000);
      
      expect(duration1.isShorterThan(duration2)).toBe(true);
      expect(duration2.isLongerThan(duration1)).toBe(true);
      expect(duration1.equals(new Duration(1000))).toBe(true);
    });
  });

  describe('TimingUtils', () => {
    test('should create and stop timer', () => {
      const timer = TimingUtils.createTimer();
      
      // Simulate some time passing
      jest.advanceTimersByTime(100);
      
      const duration = timer.stop();
      expect(duration.inMilliseconds).toBeGreaterThan(0);
      expect(timer.isStopped).toBe(true);
    });

    test('should measure async function execution', async () => {
      const testFn = async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return 'result';
      };

      const { result, duration } = await TimingUtils.measureAsync(testFn);
      
      expect(result).toBe('result');
      expect(duration.inMilliseconds).toBeGreaterThan(0);
    });
  });

  describe('UrlUtils', () => {
    test('should sanitize URLs with sensitive parameters', () => {
      const url = 'https://api.example.com/data?token=secret123&name=test';
      const sanitized = UrlUtils.sanitizeUrl(url);
      
      expect(sanitized).toContain('token=[REDACTED]');
      expect(sanitized).toContain('name=test');
      expect(sanitized).not.toContain('secret123');
    });

    test('should extract domain from URL', () => {
      const url = 'https://api.example.com/path?query=value';
      const domain = UrlUtils.extractDomain(url);
      
      expect(domain).toBe('api.example.com');
    });

    test('should check if URL should be ignored', () => {
      const url = 'https://analytics.example.com/track';
      const ignoredDomains = ['analytics.example.com'];
      
      const shouldIgnore = UrlUtils.shouldIgnoreUrl(url, [], ignoredDomains);
      expect(shouldIgnore).toBe(true);
    });

    test('should sanitize headers', () => {
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer secret-token',
        'X-Custom': 'value'
      };

      const sanitized = UrlUtils.sanitizeHeaders(headers);
      
      expect(sanitized['Content-Type']).toBe('application/json');
      expect(sanitized['Authorization']).toBe('[REDACTED]');
      expect(sanitized['X-Custom']).toBe('value');
    });
  });

  describe('HttpRequestTelemetry', () => {
    test('should create HTTP request telemetry with correct attributes', () => {
      const telemetryData = {
        url: 'https://api.example.com/users',
        method: 'GET',
        statusCode: 200,
        duration: new Duration(150),
        timestamp: new Date('2023-01-01T00:00:00Z'),
        responseSize: 1024,
        requestSize: 256
      };

      const telemetry = new HttpRequestTelemetry(telemetryData);
      const attributes = telemetry.toAttributes();

      expect(attributes['http.url']).toBe('https://api.example.com/users');
      expect(attributes['http.method']).toBe('GET');
      expect(attributes['http.status_code']).toBe('200');
      expect(attributes['http.duration_ms']).toBe('150');
      expect(attributes['http.success']).toBe('true');
      expect(attributes['http.category']).toBe('success');
      expect(attributes['http.performance']).toBe('normal');
    });

    test('should categorize HTTP responses correctly', () => {
      const testCases = [
        { statusCode: 200, expected: 'success' },
        { statusCode: 301, expected: 'redirect' },
        { statusCode: 404, expected: 'client_error' },
        { statusCode: 500, expected: 'server_error' },
        { statusCode: 0, error: 'Network error', expected: 'network_error' }
      ];

      testCases.forEach(({ statusCode, error, expected }) => {
        const telemetry = new HttpRequestTelemetry({
          url: 'https://api.example.com/test',
          method: 'GET',
          statusCode,
          duration: new Duration(100),
          timestamp: new Date(),
          error
        });

        expect(telemetry.category).toBe(expected);
      });
    });

    test('should determine performance categories correctly', () => {
      const testCases = [
        { duration: 50, expected: 'fast' },
        { duration: 200, expected: 'normal' },
        { duration: 1000, expected: 'slow' },
        { duration: 3000, expected: 'very_slow' }
      ];

      testCases.forEach(({ duration, expected }) => {
        const telemetry = new HttpRequestTelemetry({
          url: 'https://api.example.com/test',
          method: 'GET',
          statusCode: 200,
          duration: new Duration(duration),
          timestamp: new Date()
        });

        expect(telemetry.performanceCategory).toBe(expected);
      });
    });
  });

  describe('HttpTelemetryCollector', () => {
    test('should process HTTP request and create telemetry events', () => {
      const collector = new HttpTelemetryCollector(['http_request', 'http_error']);
      
      const httpTelemetry = new HttpRequestTelemetry({
        url: 'https://api.example.com/test',
        method: 'GET',
        statusCode: 200,
        duration: new Duration(150),
        timestamp: new Date()
      });

      const events = collector.processHttpRequest(httpTelemetry);
      
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('http_request');
      expect(events[0].attributes['http.url']).toBe('https://api.example.com/test');
      expect(events[0].metrics['http.duration']).toBe(150);
    });

    test('should create error events for failed requests', () => {
      const collector = new HttpTelemetryCollector(['http_request', 'http_error']);
      
      const httpTelemetry = new HttpRequestTelemetry({
        url: 'https://api.example.com/test',
        method: 'GET',
        statusCode: 500,
        duration: new Duration(150),
        timestamp: new Date(),
        error: 'Internal Server Error'
      });

      const events = collector.processHttpRequest(httpTelemetry);
      
      expect(events).toHaveLength(2); // http_request + http_error
      const errorEvent = events.find(e => e.type === 'http_error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent?.attributes['error.message']).toBe('Internal Server Error');
    });

    test('should create performance events for slow requests', () => {
      const collector = new HttpTelemetryCollector(['http_request', 'http_performance']);
      
      const httpTelemetry = new HttpRequestTelemetry({
        url: 'https://api.example.com/test',
        method: 'GET',
        statusCode: 200,
        duration: new Duration(3000), // Slow request
        timestamp: new Date()
      });

      const events = collector.processHttpRequest(httpTelemetry);
      
      expect(events).toHaveLength(2); // http_request + http_performance
      const perfEvent = events.find(e => e.type === 'http_performance');
      expect(perfEvent).toBeDefined();
      expect(perfEvent?.attributes['performance.issue']).toBe('slow_response');
    });
  });

  describe('HttpMetricsTracker', () => {
    test('should track HTTP request metrics', () => {
      const tracker = new HttpMetricsTracker();
      
      const httpTelemetry = new HttpRequestTelemetry({
        url: 'https://api.example.com/users',
        method: 'GET',
        statusCode: 200,
        duration: new Duration(150),
        timestamp: new Date(),
        responseSize: 1024
      });

      tracker.trackRequest(httpTelemetry);
      
      const globalMetrics = tracker.getGlobalMetrics();
      expect(globalMetrics.totalRequests).toBe(1);
      expect(globalMetrics.successfulRequests).toBe(1);
      expect(globalMetrics.failedRequests).toBe(0);
      expect(globalMetrics.averageResponseTime.inMilliseconds).toBe(150);
      expect(globalMetrics.totalBytesReceived).toBe(1024);
    });

    test('should track domain-specific metrics', () => {
      const tracker = new HttpMetricsTracker();
      
      const httpTelemetry1 = new HttpRequestTelemetry({
        url: 'https://api.example.com/users',
        method: 'GET',
        statusCode: 200,
        duration: new Duration(100),
        timestamp: new Date()
      });

      const httpTelemetry2 = new HttpRequestTelemetry({
        url: 'https://api.example.com/posts',
        method: 'GET',
        statusCode: 404,
        duration: new Duration(200),
        timestamp: new Date()
      });

      tracker.trackRequest(httpTelemetry1);
      tracker.trackRequest(httpTelemetry2);
      
      const domainMetrics = tracker.getDomainMetrics('api.example.com');
      expect(domainMetrics).toBeDefined();
      expect(domainMetrics!.totalRequests).toBe(2);
      expect(domainMetrics!.successfulRequests).toBe(1);
      expect(domainMetrics!.failedRequests).toBe(1);
      expect(domainMetrics!.errorRate).toBe(0.5);
    });

    test('should get top domains by request count', () => {
      const tracker = new HttpMetricsTracker();
      
      // Add requests for different domains
      const domains = ['api.example.com', 'cdn.example.com', 'auth.example.com'];
      const requestCounts = [5, 3, 7];

      domains.forEach((domain, index) => {
        for (let i = 0; i < requestCounts[index]; i++) {
          const telemetry = new HttpRequestTelemetry({
            url: `https://${domain}/test`,
            method: 'GET',
            statusCode: 200,
            duration: new Duration(100),
            timestamp: new Date()
          });
          tracker.trackRequest(telemetry);
        }
      });

      const topDomains = tracker.getTopDomains(2);
      expect(topDomains).toHaveLength(2);
      expect(topDomains[0].domain).toBe('auth.example.com'); // 7 requests
      expect(topDomains[1].domain).toBe('api.example.com'); // 5 requests
    });
  });

  describe('NetworkMonitorManager Integration', () => {
    test('should initialize and manage HTTP monitoring', async () => {
      const config = {
        serviceName: 'test-service',
        endpoint: 'https://telemetry.example.com',
        httpMonitoring: true,
        debug: false,
        httpIgnoredUrls: ['https://ignored.com'],
        httpIgnoredDomains: ['analytics.com']
      };

      const manager = new NetworkMonitorManager(config as any);
      const mockTelemetryHandler = jest.fn();

      await manager.initialize(mockTelemetryHandler);
      
      const status = manager.getStatus();
      expect(status.initialized).toBe(true);
      expect(status.httpMonitoring).toBe(true);
      
      manager.shutdown();
    });

    test('should provide network information', async () => {
      const config = {
        serviceName: 'test-service',
        endpoint: 'https://telemetry.example.com',
        httpMonitoring: true
      };

      const manager = new NetworkMonitorManager(config as any);
      await manager.initialize(jest.fn());

      const networkInfo = manager.getCurrentNetworkInfo();
      expect(networkInfo).toHaveProperty('isConnected');
      expect(networkInfo).toHaveProperty('connectionType');
      expect(networkInfo).toHaveProperty('quality');

      manager.shutdown();
    });
  });

  describe('EdgeTelemetry Integration', () => {
    test('should initialize EdgeTelemetry with HTTP monitoring', async () => {
      const initConfig: TelemetryInitConfig = {
        serviceName: 'test-service',
        endpoint: 'https://telemetry.example.com',
        enableHttpMonitoring: true,
        debugMode: false
      };

      await EdgeTelemetry.initialize(initConfig);
      const instance = EdgeTelemetry.getInstance();

      const status = instance.getHttpMonitoringStatus();
      expect(status.enabled).toBe(true);
      expect(status.initialized).toBe(true);
    });

    test('should install Axios interceptor', async () => {
      const initConfig: TelemetryInitConfig = {
        serviceName: 'test-service',
        endpoint: 'https://telemetry.example.com',
        enableHttpMonitoring: true
      };

      await EdgeTelemetry.initialize(initConfig);
      const instance = EdgeTelemetry.getInstance();

      const mockAxios = {
        interceptors: {
          request: { use: jest.fn().mockReturnValue(1) },
          response: { use: jest.fn().mockReturnValue(2) }
        }
      };

      instance.installAxiosInterceptor(mockAxios);
      
      expect(mockAxios.interceptors.request.use).toHaveBeenCalled();
      expect(mockAxios.interceptors.response.use).toHaveBeenCalled();
    });
  });

  describe('Flutter Compatibility', () => {
    test('should produce Flutter-compatible telemetry event structure', () => {
      const collector = new HttpTelemetryCollector(['http_request']);
      
      const httpTelemetry = new HttpRequestTelemetry({
        url: 'https://api.example.com/users',
        method: 'GET',
        statusCode: 200,
        duration: new Duration(150),
        timestamp: new Date('2023-01-01T00:00:00Z'),
        responseSize: 1024,
        requestSize: 256
      });

      const events = collector.processHttpRequest(httpTelemetry);
      const event = events[0];

      // Verify Flutter-compatible structure
      expect(event).toHaveProperty('id');
      expect(event).toHaveProperty('type', 'http_request');
      expect(event).toHaveProperty('timestamp');
      expect(event).toHaveProperty('attributes');
      expect(event).toHaveProperty('metrics');

      // Verify Flutter-compatible attributes
      expect(event.attributes).toHaveProperty('http.url');
      expect(event.attributes).toHaveProperty('http.method');
      expect(event.attributes).toHaveProperty('http.status_code');
      expect(event.attributes).toHaveProperty('http.duration_ms');
      expect(event.attributes).toHaveProperty('http.success');
      expect(event.attributes).toHaveProperty('http.category');
      expect(event.attributes).toHaveProperty('http.performance');
      expect(event.attributes).toHaveProperty('event.category', 'http');
      expect(event.attributes).toHaveProperty('event.action', 'request');
      expect(event.attributes).toHaveProperty('event.outcome');

      // Verify Flutter-compatible metrics
      expect(event.metrics).toHaveProperty('http.duration', 150);
      expect(event.metrics).toHaveProperty('http.response_size', 1024);
      expect(event.metrics).toHaveProperty('http.request_size', 256);
    });

    test('should match Flutter HTTP error event structure', () => {
      const collector = new HttpTelemetryCollector(['http_error']);
      
      const httpTelemetry = new HttpRequestTelemetry({
        url: 'https://api.example.com/error',
        method: 'POST',
        statusCode: 500,
        duration: new Duration(200),
        timestamp: new Date(),
        error: 'Internal Server Error'
      });

      const events = collector.processHttpRequest(httpTelemetry);
      const errorEvent = events[0];

      expect(errorEvent.type).toBe('http_error');
      expect(errorEvent.attributes).toHaveProperty('event.category', 'error');
      expect(errorEvent.attributes).toHaveProperty('event.action', 'http_request_failed');
      expect(errorEvent.attributes).toHaveProperty('error.type', 'server_error');
      expect(errorEvent.attributes).toHaveProperty('error.message', 'Internal Server Error');
      expect(errorEvent.attributes).toHaveProperty('severity', 'error');
      expect(errorEvent.metrics).toHaveProperty('error.count', 1);
    });
  });
});
