import type { PerformanceEvent, BundleMetrics, PerformanceObserverCallback } from '../types/PerformanceTypes';

/**
 * BundleMetricsMonitor - Tracks bundle loading and parsing performance metrics
 * Phase 10: Performance Monitoring
 */
export class BundleMetricsMonitor {
  private isInitialized = false;
  private debugMode = false;
  private bundleMetrics: Partial<BundleMetrics> = {};
  private onPerformanceEvent?: PerformanceObserverCallback;
  private bundleLoadStartTime = 0;
  private bundleParseStartTime = 0;
  private bundleExecutionStartTime = 0;
  private cacheHits = 0;
  private cacheMisses = 0;

  // Bundle tracking
  private originalRequire?: any;
  private bundleRequests: Map<string, { startTime: number; size?: number }> = new Map();

  constructor(
    onPerformanceEvent?: PerformanceObserverCallback,
    debugMode = false
  ) {
    this.onPerformanceEvent = onPerformanceEvent;
    this.debugMode = debugMode;
    
    // Record bundle load start time immediately
    this.bundleLoadStartTime = Date.now();
  }

  /**
   * Initialize bundle metrics monitoring
   */
  initialize(): void {
    if (this.isInitialized) {
      if (this.debugMode) {
        console.warn('BundleMetricsMonitor: Already initialized');
      }
      return;
    }

    try {
      // Setup bundle loading monitoring
      this.setupBundleLoadMonitoring();

      // Setup bundle parsing monitoring
      this.setupBundleParsingMonitoring();

      // Setup bundle execution monitoring
      this.setupBundleExecutionMonitoring();

      // Setup cache monitoring
      this.setupCacheMonitoring();

      // Measure initial bundle size
      this.measureBundleSize();

      this.isInitialized = true;

      if (this.debugMode) {
        console.log('BundleMetricsMonitor: Initialized');
      }
    } catch (error) {
      if (this.debugMode) {
        console.error('BundleMetricsMonitor: Failed to initialize:', error);
      }
      throw error;
    }
  }

  /**
   * Setup bundle loading monitoring
   */
  private setupBundleLoadMonitoring(): void {
    try {
      // Monitor bundle loading via require interception
      if (typeof global !== 'undefined' && global.require) {
        this.originalRequire = global.require;
        
        global.require = (moduleId: string) => {
          const startTime = Date.now();
          this.bundleRequests.set(moduleId, { startTime });
          
          try {
            const result = this.originalRequire!(moduleId);
            const endTime = Date.now();
            const loadTime = endTime - startTime;
            
            this.recordBundleLoad(moduleId, loadTime, true);
            return result;
          } catch (error) {
            const endTime = Date.now();
            const loadTime = endTime - startTime;
            
            this.recordBundleLoad(moduleId, loadTime, false, error);
            throw error;
          }
        };
      }

      // Monitor main bundle load completion
      this.monitorMainBundleLoad();

      if (this.debugMode) {
        console.log('BundleMetricsMonitor: Bundle loading monitoring setup complete');
      }
    } catch (error) {
      if (this.debugMode) {
        console.warn('BundleMetricsMonitor: Bundle loading monitoring setup failed:', error);
      }
    }
  }

  /**
   * Monitor main bundle loading
   */
  private monitorMainBundleLoad(): void {
    try {
      // Use various methods to detect when main bundle is loaded
      
      // Method 1: Check for React Native bridge
      if (typeof global !== 'undefined' && (global as any).__fbBatchedBridge) {
        const loadTime = Date.now() - this.bundleLoadStartTime;
        this.bundleMetrics.loadTime = loadTime;
        this.emitPerformanceEvent('bundle_load_time', loadTime, 'ms');
      }

      // Method 2: Use setTimeout to check periodically
      const checkBundleLoad = () => {
        if (typeof global !== 'undefined' && (global as any).__DEV__ !== undefined) {
          const loadTime = Date.now() - this.bundleLoadStartTime;
          if (!this.bundleMetrics.loadTime) {
            this.bundleMetrics.loadTime = loadTime;
            this.emitPerformanceEvent('bundle_load_time', loadTime, 'ms');
          }
        } else {
          setTimeout(checkBundleLoad, 100);
        }
      };
      
      setTimeout(checkBundleLoad, 100);

      // Method 3: Monitor document ready state (for web)
      if (typeof document !== 'undefined') {
        const checkDocumentReady = () => {
          if (document.readyState === 'complete') {
            const loadTime = Date.now() - this.bundleLoadStartTime;
            if (!this.bundleMetrics.loadTime) {
              this.bundleMetrics.loadTime = loadTime;
              this.emitPerformanceEvent('bundle_load_time', loadTime, 'ms');
            }
          } else {
            setTimeout(checkDocumentReady, 100);
          }
        };
        
        checkDocumentReady();
      }
    } catch (error) {
      if (this.debugMode) {
        console.warn('BundleMetricsMonitor: Main bundle monitoring failed:', error);
      }
    }
  }

  /**
   * Setup bundle parsing monitoring
   */
  private setupBundleParsingMonitoring(): void {
    try {
      this.bundleParseStartTime = Date.now();

      // Monitor JavaScript parsing via performance API
      if (typeof global !== 'undefined' && (global as any).performance) {
        const performance = (global as any).performance;
        
        if (performance.mark) {
          performance.mark('bundle-parse-start');
        }

        // Monitor when parsing completes
        setTimeout(() => {
          const parseTime = Date.now() - this.bundleParseStartTime;
          this.bundleMetrics.parseTime = parseTime;
          this.emitPerformanceEvent('bundle_parse_time', parseTime, 'ms');
          
          if (performance.mark) {
            performance.mark('bundle-parse-end');
            if (performance.measure) {
              performance.measure('bundle-parse', 'bundle-parse-start', 'bundle-parse-end');
            }
          }
        }, 50); // Small delay to ensure parsing is complete
      }

      if (this.debugMode) {
        console.log('BundleMetricsMonitor: Bundle parsing monitoring setup complete');
      }
    } catch (error) {
      if (this.debugMode) {
        console.warn('BundleMetricsMonitor: Bundle parsing monitoring setup failed:', error);
      }
    }
  }

  /**
   * Setup bundle execution monitoring
   */
  private setupBundleExecutionMonitoring(): void {
    try {
      this.bundleExecutionStartTime = Date.now();

      // Monitor when bundle execution completes
      const checkExecutionComplete = () => {
        // Check if React is available (indicates execution is largely complete)
        if (typeof global !== 'undefined' && (global as any).React) {
          const executionTime = Date.now() - this.bundleExecutionStartTime;
          this.bundleMetrics.executionTime = executionTime;
          this.emitPerformanceEvent('bundle_execution_time', executionTime, 'ms');
        } else {
          setTimeout(checkExecutionComplete, 100);
        }
      };

      setTimeout(checkExecutionComplete, 100);

      if (this.debugMode) {
        console.log('BundleMetricsMonitor: Bundle execution monitoring setup complete');
      }
    } catch (error) {
      if (this.debugMode) {
        console.warn('BundleMetricsMonitor: Bundle execution monitoring setup failed:', error);
      }
    }
  }

  /**
   * Setup cache monitoring
   */
  private setupCacheMonitoring(): void {
    try {
      // Monitor module cache hits/misses
      if (typeof global !== 'undefined' && global.require && (global.require as any).cache) {
        const cache = (global.require as any).cache;
        
        // Monitor cache access patterns
        const originalGet = cache.get;
        if (originalGet) {
          cache.get = (key: string) => {
            const result = originalGet.call(cache, key);
            if (result) {
              this.cacheHits++;
            } else {
              this.cacheMisses++;
            }
            return result;
          };
        }
      }

      // Calculate cache hit rate periodically
      setInterval(() => {
        this.calculateCacheHitRate();
      }, 10000); // Every 10 seconds

      if (this.debugMode) {
        console.log('BundleMetricsMonitor: Cache monitoring setup complete');
      }
    } catch (error) {
      if (this.debugMode) {
        console.warn('BundleMetricsMonitor: Cache monitoring setup failed:', error);
      }
    }
  }

  /**
   * Measure bundle size
   */
  private measureBundleSize(): void {
    try {
      // Estimate bundle size from various sources
      let bundleSize = 0;

      // Method 1: Use performance navigation API (web)
      if (typeof navigator !== 'undefined' && (navigator as any).connection) {
        const connection = (navigator as any).connection;
        if (connection.transferSize) {
          bundleSize = connection.transferSize;
        }
      }

      // Method 2: Estimate from source code length
      if (!bundleSize && typeof global !== 'undefined') {
        // Rough estimation based on global object size
        const globalKeys = Object.keys(global);
        bundleSize = globalKeys.length * 1000; // Very rough estimate
      }

      // Method 3: Use bundle analyzer data if available
      if (typeof global !== 'undefined' && (global as any).__BUNDLE_SIZE__) {
        bundleSize = (global as any).__BUNDLE_SIZE__;
      }

      if (bundleSize > 0) {
        this.bundleMetrics.bundleSize = bundleSize;
        this.emitPerformanceEvent('bundle_size', bundleSize, 'bytes');
      }

      if (this.debugMode) {
        console.log('BundleMetricsMonitor: Bundle size estimated:', bundleSize, 'bytes');
      }
    } catch (error) {
      if (this.debugMode) {
        console.warn('BundleMetricsMonitor: Bundle size measurement failed:', error);
      }
    }
  }

  /**
   * Record bundle load event
   */
  private recordBundleLoad(moduleId: string, loadTime: number, success: boolean, error?: any): void {
    const bundleRequest = this.bundleRequests.get(moduleId);
    if (bundleRequest) {
      this.bundleRequests.delete(moduleId);
    }

    // Track module load performance
    if (loadTime > 100) { // Slow module load threshold
      const slowLoadEvent = {
        name: 'slow_module_load',
        entryType: 'measure',
        startTime: Date.now() - loadTime,
        duration: loadTime,
        category: 'bundle' as const,
        attributes: {
          module_id: moduleId,
          load_time: loadTime,
          success,
          error_message: error?.message || null
        }
      };

      if (this.onPerformanceEvent) {
        this.onPerformanceEvent([slowLoadEvent]);
      }
    }

    if (this.debugMode && loadTime > 50) {
      console.log('BundleMetricsMonitor: Module load:', moduleId, loadTime, 'ms');
    }
  }

  /**
   * Calculate cache hit rate
   */
  private calculateCacheHitRate(): void {
    const totalRequests = this.cacheHits + this.cacheMisses;
    if (totalRequests > 0) {
      const hitRate = this.cacheHits / totalRequests;
      this.bundleMetrics.cacheHitRate = hitRate;
      this.emitPerformanceEvent('cache_hit_rate', hitRate, 'ratio');
      
      if (this.debugMode) {
        console.log('BundleMetricsMonitor: Cache hit rate:', (hitRate * 100).toFixed(2), '%');
      }
    }
  }

  /**
   * Emit performance event
   */
  private emitPerformanceEvent(metricName: string, value: number, unit: string): void {
    if (!this.onPerformanceEvent) {
      return;
    }

    const performanceEntry = {
      name: metricName,
      entryType: 'measure',
      startTime: Date.now(),
      duration: 0,
      category: 'bundle' as const,
      attributes: {
        unit,
        value,
        timestamp: Date.now()
      }
    };

    this.onPerformanceEvent([performanceEntry]);
  }

  /**
   * Force bundle metrics collection
   */
  forceBundleMetricsCollection(): void {
    this.measureBundleSize();
    this.calculateCacheHitRate();
  }

  /**
   * Get current bundle metrics
   */
  getBundleMetrics(): Partial<BundleMetrics> {
    return { ...this.bundleMetrics };
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    cacheHits: number;
    cacheMisses: number;
    totalRequests: number;
    hitRate: number;
  } {
    const totalRequests = this.cacheHits + this.cacheMisses;
    const hitRate = totalRequests > 0 ? this.cacheHits / totalRequests : 0;

    return {
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      totalRequests,
      hitRate
    };
  }

  /**
   * Reset cache statistics
   */
  resetCacheStats(): void {
    this.cacheHits = 0;
    this.cacheMisses = 0;
    
    if (this.debugMode) {
      console.log('BundleMetricsMonitor: Cache statistics reset');
    }
  }

  /**
   * Get bundle load timing breakdown
   */
  getBundleTimingBreakdown(): {
    loadTime: number;
    parseTime: number;
    executionTime: number;
    totalTime: number;
  } {
    return {
      loadTime: this.bundleMetrics.loadTime || 0,
      parseTime: this.bundleMetrics.parseTime || 0,
      executionTime: this.bundleMetrics.executionTime || 0,
      totalTime: (this.bundleMetrics.loadTime || 0) + 
                 (this.bundleMetrics.parseTime || 0) + 
                 (this.bundleMetrics.executionTime || 0)
    };
  }

  /**
   * Check if monitoring is active
   */
  isActive(): boolean {
    return this.isInitialized;
  }

  /**
   * Get monitor status
   */
  getStatus(): Record<string, any> {
    return {
      initialized: this.isInitialized,
      metrics: this.bundleMetrics,
      cacheStats: this.getCacheStats(),
      timingBreakdown: this.getBundleTimingBreakdown(),
      activeRequests: this.bundleRequests.size,
      debugMode: this.debugMode
    };
  }

  /**
   * Dispose of bundle metrics monitoring
   */
  dispose(): void {
    // Restore original require function
    if (this.originalRequire && typeof global !== 'undefined') {
      global.require = this.originalRequire;
    }

    this.isInitialized = false;
    this.bundleMetrics = {};
    this.bundleRequests.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.onPerformanceEvent = undefined;

    if (this.debugMode) {
      console.log('BundleMetricsMonitor: Disposed');
    }
  }
}
