import type { PerformanceEvent, MemoryMetrics, PerformanceObserverCallback } from '../types/PerformanceTypes';

/**
 * MemoryMonitor - Tracks memory usage and performance metrics
 * Phase 10: Performance Monitoring
 */
export class MemoryMonitor {
  private isInitialized = false;
  private debugMode = false;
  private monitoringInterval?: any;
  private memoryMetrics: Partial<MemoryMetrics> = {};
  private onPerformanceEvent?: PerformanceObserverCallback;
  private memoryWarningCount = 0;
  private lastMemoryCheck = 0;
  private memoryWarningThreshold = 100; // MB

  // Monitoring configuration
  private monitoringIntervalMs = 30000; // 30 seconds
  private enableMemoryWarnings = true;

  constructor(
    onPerformanceEvent?: PerformanceObserverCallback,
    debugMode = false,
    config: {
      monitoringInterval?: number;
      memoryWarningThreshold?: number;
      enableMemoryWarnings?: boolean;
    } = {}
  ) {
    this.onPerformanceEvent = onPerformanceEvent;
    this.debugMode = debugMode;
    this.monitoringIntervalMs = config.monitoringInterval || this.monitoringIntervalMs;
    this.memoryWarningThreshold = config.memoryWarningThreshold || this.memoryWarningThreshold;
    this.enableMemoryWarnings = config.enableMemoryWarnings !== false;
  }

  /**
   * Initialize memory monitoring
   */
  initialize(): void {
    if (this.isInitialized) {
      if (this.debugMode) {
        console.warn('MemoryMonitor: Already initialized');
      }
      return;
    }

    try {
      // Setup memory monitoring
      this.setupMemoryMonitoring();

      // Setup memory warning listeners
      this.setupMemoryWarningListeners();

      // Start periodic monitoring
      this.startPeriodicMonitoring();

      // Take initial memory snapshot
      this.collectMemoryMetrics();

      this.isInitialized = true;

      if (this.debugMode) {
        console.log('MemoryMonitor: Initialized with config:', {
          monitoringInterval: this.monitoringIntervalMs,
          memoryWarningThreshold: this.memoryWarningThreshold,
          enableMemoryWarnings: this.enableMemoryWarnings
        });
      }
    } catch (error) {
      if (this.debugMode) {
        console.error('MemoryMonitor: Failed to initialize:', error);
      }
      throw error;
    }
  }

  /**
   * Setup memory monitoring capabilities
   */
  private setupMemoryMonitoring(): void {
    try {
      // Check for performance.memory API (Chrome/V8)
      if (typeof global !== 'undefined' && (global as any).performance?.memory) {
        if (this.debugMode) {
          console.log('MemoryMonitor: Using performance.memory API');
        }
      }

      // Check for React Native memory APIs
      if (typeof global !== 'undefined' && (global as any).nativePerformanceObserver) {
        if (this.debugMode) {
          console.log('MemoryMonitor: Using React Native performance observer');
        }
      }

      // Setup garbage collection monitoring if available
      this.setupGCMonitoring();
    } catch (error) {
      if (this.debugMode) {
        console.warn('MemoryMonitor: Memory monitoring setup failed:', error);
      }
    }
  }

  /**
   * Setup garbage collection monitoring
   */
  private setupGCMonitoring(): void {
    try {
      // Monitor garbage collection events if available
      if (typeof global !== 'undefined' && (global as any).gc) {
        const originalGC = (global as any).gc;
        (global as any).gc = (...args: any[]) => {
          const beforeMemory = this.getCurrentMemoryUsage();
          const result = originalGC.apply(global, args);
          const afterMemory = this.getCurrentMemoryUsage();
          
          this.handleGCEvent(beforeMemory, afterMemory);
          return result;
        };
      }

      // Setup FinalizationRegistry for memory leak detection
      if (typeof FinalizationRegistry !== 'undefined') {
        const registry = new FinalizationRegistry((heldValue: string) => {
          if (this.debugMode) {
            console.log('MemoryMonitor: Object finalized:', heldValue);
          }
        });
      }
    } catch (error) {
      if (this.debugMode) {
        console.warn('MemoryMonitor: GC monitoring setup failed:', error);
      }
    }
  }

  /**
   * Setup memory warning listeners
   */
  private setupMemoryWarningListeners(): void {
    if (!this.enableMemoryWarnings) {
      return;
    }

    try {
      // React Native memory warning listener
      if (typeof global !== 'undefined' && (global as any).nativeApplicationProxy) {
        const appProxy = (global as any).nativeApplicationProxy;
        if (appProxy.addMemoryWarningListener) {
          appProxy.addMemoryWarningListener(() => {
            this.handleMemoryWarning();
          });
        }
      }

      // Browser memory pressure API
      if (typeof navigator !== 'undefined' && (navigator as any).deviceMemory) {
        // Monitor device memory constraints
        const deviceMemory = (navigator as any).deviceMemory;
        if (deviceMemory < 4) { // Less than 4GB
          this.memoryWarningThreshold = Math.max(50, this.memoryWarningThreshold * 0.7);
          if (this.debugMode) {
            console.log('MemoryMonitor: Adjusted threshold for low-memory device:', this.memoryWarningThreshold);
          }
        }
      }
    } catch (error) {
      if (this.debugMode) {
        console.warn('MemoryMonitor: Memory warning listeners setup failed:', error);
      }
    }
  }

  /**
   * Start periodic memory monitoring
   */
  private startPeriodicMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    this.monitoringInterval = setInterval(() => {
      this.collectMemoryMetrics();
    }, this.monitoringIntervalMs);

    if (this.debugMode) {
      console.log('MemoryMonitor: Started periodic monitoring every', this.monitoringIntervalMs, 'ms');
    }
  }

  /**
   * Collect current memory metrics
   */
  private collectMemoryMetrics(): void {
    try {
      const currentTime = Date.now();
      const memoryUsage = this.getCurrentMemoryUsage();

      // Update metrics
      this.memoryMetrics = {
        ...this.memoryMetrics,
        ...memoryUsage,
        memoryWarnings: this.memoryWarningCount
      };

      // Emit performance events
      this.emitMemoryEvents(memoryUsage);

      // Check for memory warnings
      this.checkMemoryThresholds(memoryUsage);

      this.lastMemoryCheck = currentTime;

      if (this.debugMode) {
        console.log('MemoryMonitor: Memory metrics collected:', this.memoryMetrics);
      }
    } catch (error) {
      if (this.debugMode) {
        console.error('MemoryMonitor: Failed to collect memory metrics:', error);
      }
    }
  }

  /**
   * Get current memory usage from available APIs
   */
  private getCurrentMemoryUsage(): Partial<MemoryMetrics> {
    const memoryUsage: Partial<MemoryMetrics> = {};

    try {
      // Chrome/V8 performance.memory API
      if (typeof global !== 'undefined' && (global as any).performance?.memory) {
        const memory = (global as any).performance.memory;
        memoryUsage.usedJSHeapSize = memory.usedJSHeapSize;
        memoryUsage.totalJSHeapSize = memory.totalJSHeapSize;
        memoryUsage.jsHeapSizeLimit = memory.jsHeapSizeLimit;
      }

      // React Native memory info
      if (typeof global !== 'undefined' && (global as any).nativePerformanceObserver) {
        // Try to get native memory info
        const nativeMemory = this.getNativeMemoryInfo();
        if (nativeMemory) {
          memoryUsage.nativeHeapSize = nativeMemory.nativeHeapSize;
          memoryUsage.imageMemoryUsage = nativeMemory.imageMemoryUsage;
        }
      }

      // Fallback: Estimate memory usage
      if (!memoryUsage.usedJSHeapSize) {
        memoryUsage.usedJSHeapSize = this.estimateMemoryUsage();
      }
    } catch (error) {
      if (this.debugMode) {
        console.warn('MemoryMonitor: Failed to get memory usage:', error);
      }
    }

    return memoryUsage;
  }

  /**
   * Get native memory information (React Native specific)
   */
  private getNativeMemoryInfo(): { nativeHeapSize?: number; imageMemoryUsage?: number } | null {
    try {
      // This would typically use a native module
      // For now, return null as this requires platform-specific implementation
      return null;
    } catch (error) {
      if (this.debugMode) {
        console.warn('MemoryMonitor: Failed to get native memory info:', error);
      }
      return null;
    }
  }

  /**
   * Estimate memory usage when precise APIs are not available
   */
  private estimateMemoryUsage(): number {
    try {
      // Rough estimation based on object count and sizes
      let estimatedSize = 0;
      
      // Count global objects
      if (typeof global !== 'undefined') {
        const globalKeys = Object.keys(global);
        estimatedSize += globalKeys.length * 1000; // Rough estimate
      }

      // Add base React Native overhead
      estimatedSize += 20 * 1024 * 1024; // 20MB base

      return estimatedSize;
    } catch (error) {
      if (this.debugMode) {
        console.warn('MemoryMonitor: Failed to estimate memory usage:', error);
      }
      return 0;
    }
  }

  /**
   * Emit memory performance events
   */
  private emitMemoryEvents(memoryUsage: Partial<MemoryMetrics>): void {
    if (!this.onPerformanceEvent) {
      return;
    }

    const currentTime = Date.now();

    // Emit individual memory metrics
    if (memoryUsage.usedJSHeapSize) {
      this.emitPerformanceEvent('js_heap_used', memoryUsage.usedJSHeapSize, 'bytes');
    }

    if (memoryUsage.totalJSHeapSize) {
      this.emitPerformanceEvent('js_heap_total', memoryUsage.totalJSHeapSize, 'bytes');
    }

    if (memoryUsage.jsHeapSizeLimit) {
      this.emitPerformanceEvent('js_heap_limit', memoryUsage.jsHeapSizeLimit, 'bytes');
    }

    if (memoryUsage.nativeHeapSize) {
      this.emitPerformanceEvent('native_heap_size', memoryUsage.nativeHeapSize, 'bytes');
    }

    // Emit memory warning count
    this.emitPerformanceEvent('memory_warnings', this.memoryWarningCount, 'count');
  }

  /**
   * Check memory thresholds and emit warnings
   */
  private checkMemoryThresholds(memoryUsage: Partial<MemoryMetrics>): void {
    if (!this.enableMemoryWarnings) {
      return;
    }

    try {
      const usedMemoryMB = (memoryUsage.usedJSHeapSize || 0) / (1024 * 1024);
      
      if (usedMemoryMB > this.memoryWarningThreshold) {
        this.handleMemoryWarning();
      }

      // Check heap utilization
      if (memoryUsage.usedJSHeapSize && memoryUsage.totalJSHeapSize) {
        const heapUtilization = memoryUsage.usedJSHeapSize / memoryUsage.totalJSHeapSize;
        if (heapUtilization > 0.9) { // 90% heap utilization
          this.handleMemoryWarning('high_heap_utilization');
        }
      }
    } catch (error) {
      if (this.debugMode) {
        console.warn('MemoryMonitor: Memory threshold check failed:', error);
      }
    }
  }

  /**
   * Handle memory warning events
   */
  private handleMemoryWarning(type = 'memory_pressure'): void {
    this.memoryWarningCount++;
    
    const warningEvent = {
      name: 'memory_warning',
      entryType: 'measure',
      startTime: Date.now(),
      duration: 0,
      category: 'memory' as const,
      attributes: {
        warning_type: type,
        warning_count: this.memoryWarningCount,
        current_memory: this.memoryMetrics.usedJSHeapSize || 0,
        threshold: this.memoryWarningThreshold * 1024 * 1024 // Convert to bytes
      }
    };

    if (this.onPerformanceEvent) {
      this.onPerformanceEvent([warningEvent]);
    }

    if (this.debugMode) {
      console.warn('MemoryMonitor: Memory warning triggered:', type, 'Count:', this.memoryWarningCount);
    }
  }

  /**
   * Handle garbage collection events
   */
  private handleGCEvent(beforeMemory: Partial<MemoryMetrics>, afterMemory: Partial<MemoryMetrics>): void {
    try {
      const memoryFreed = (beforeMemory.usedJSHeapSize || 0) - (afterMemory.usedJSHeapSize || 0);
      
      const gcEvent = {
        name: 'garbage_collection',
        entryType: 'measure',
        startTime: Date.now(),
        duration: 0,
        category: 'memory' as const,
        attributes: {
          memory_freed: memoryFreed,
          before_gc: beforeMemory.usedJSHeapSize || 0,
          after_gc: afterMemory.usedJSHeapSize || 0
        }
      };

      if (this.onPerformanceEvent) {
        this.onPerformanceEvent([gcEvent]);
      }

      if (this.debugMode) {
        console.log('MemoryMonitor: GC event - freed:', memoryFreed, 'bytes');
      }
    } catch (error) {
      if (this.debugMode) {
        console.warn('MemoryMonitor: GC event handling failed:', error);
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
      category: 'memory' as const,
      attributes: {
        unit,
        value,
        timestamp: Date.now()
      }
    };

    this.onPerformanceEvent([performanceEntry]);
  }

  /**
   * Force memory collection
   */
  forceMemoryCollection(): void {
    this.collectMemoryMetrics();
  }

  /**
   * Get current memory metrics
   */
  getMemoryMetrics(): Partial<MemoryMetrics> {
    return { ...this.memoryMetrics };
  }

  /**
   * Get memory warning count
   */
  getMemoryWarningCount(): number {
    return this.memoryWarningCount;
  }

  /**
   * Reset memory warning count
   */
  resetMemoryWarningCount(): void {
    this.memoryWarningCount = 0;
  }

  /**
   * Update monitoring configuration
   */
  updateConfig(config: {
    monitoringInterval?: number;
    memoryWarningThreshold?: number;
    enableMemoryWarnings?: boolean;
  }): void {
    if (config.monitoringInterval !== undefined) {
      this.monitoringIntervalMs = config.monitoringInterval;
      if (this.isInitialized) {
        this.startPeriodicMonitoring(); // Restart with new interval
      }
    }

    if (config.memoryWarningThreshold !== undefined) {
      this.memoryWarningThreshold = config.memoryWarningThreshold;
    }

    if (config.enableMemoryWarnings !== undefined) {
      this.enableMemoryWarnings = config.enableMemoryWarnings;
    }

    if (this.debugMode) {
      console.log('MemoryMonitor: Configuration updated:', config);
    }
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
      metrics: this.memoryMetrics,
      memoryWarnings: this.memoryWarningCount,
      config: {
        monitoringInterval: this.monitoringIntervalMs,
        memoryWarningThreshold: this.memoryWarningThreshold,
        enableMemoryWarnings: this.enableMemoryWarnings
      },
      lastCheck: this.lastMemoryCheck,
      debugMode: this.debugMode
    };
  }

  /**
   * Dispose of memory monitoring
   */
  dispose(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }

    this.isInitialized = false;
    this.memoryMetrics = {};
    this.memoryWarningCount = 0;
    this.onPerformanceEvent = undefined;

    if (this.debugMode) {
      console.log('MemoryMonitor: Disposed');
    }
  }
}
