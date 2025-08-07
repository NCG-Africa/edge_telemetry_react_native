import type { PerformanceEvent, BridgeMetrics, PerformanceObserverCallback } from '../types/PerformanceTypes';

/**
 * BridgePerformanceMonitor - Tracks React Native bridge performance metrics
 * Phase 10: Performance Monitoring
 */
export class BridgePerformanceMonitor {
  private isInitialized = false;
  private debugMode = false;
  private monitoringInterval?: any;
  private bridgeMetrics: Partial<BridgeMetrics> = {};
  private onPerformanceEvent?: PerformanceObserverCallback;
  private bridgeCallTimes: number[] = [];
  private bridgeCallCount = 0;
  private lastBridgeCheck = 0;
  private bridgeCallTimeThreshold = 100; // ms

  // Monitoring configuration
  private monitoringIntervalMs = 10000; // 10 seconds
  private maxCallTimeHistory = 100; // Keep last 100 call times
  private enableBridgeCallTracking = true;

  // Bridge call tracking
  private originalBridgeCall?: any;
  private bridgeCallQueue: any[] = [];

  constructor(
    onPerformanceEvent?: PerformanceObserverCallback,
    debugMode = false,
    config: {
      monitoringInterval?: number;
      bridgeCallTimeThreshold?: number;
      enableBridgeCallTracking?: boolean;
      maxCallTimeHistory?: number;
    } = {}
  ) {
    this.onPerformanceEvent = onPerformanceEvent;
    this.debugMode = debugMode;
    this.monitoringIntervalMs = config.monitoringInterval || this.monitoringIntervalMs;
    this.bridgeCallTimeThreshold = config.bridgeCallTimeThreshold || this.bridgeCallTimeThreshold;
    this.enableBridgeCallTracking = config.enableBridgeCallTracking !== false;
    this.maxCallTimeHistory = config.maxCallTimeHistory || this.maxCallTimeHistory;
  }

  /**
   * Initialize bridge performance monitoring
   */
  initialize(): void {
    if (this.isInitialized) {
      if (this.debugMode) {
        console.warn('BridgePerformanceMonitor: Already initialized');
      }
      return;
    }

    try {
      // Setup bridge call interception
      this.setupBridgeInterception();

      // Setup bridge queue monitoring
      this.setupBridgeQueueMonitoring();

      // Start periodic monitoring
      this.startPeriodicMonitoring();

      // Take initial bridge metrics snapshot
      this.collectBridgeMetrics();

      this.isInitialized = true;

      if (this.debugMode) {
        console.log('BridgePerformanceMonitor: Initialized with config:', {
          monitoringInterval: this.monitoringIntervalMs,
          bridgeCallTimeThreshold: this.bridgeCallTimeThreshold,
          enableBridgeCallTracking: this.enableBridgeCallTracking,
          maxCallTimeHistory: this.maxCallTimeHistory
        });
      }
    } catch (error) {
      if (this.debugMode) {
        console.error('BridgePerformanceMonitor: Failed to initialize:', error);
      }
      throw error;
    }
  }

  /**
   * Setup bridge call interception for performance tracking
   */
  private setupBridgeInterception(): void {
    if (!this.enableBridgeCallTracking) {
      return;
    }

    try {
      // Intercept React Native bridge calls
      if (typeof global !== 'undefined' && (global as any).__fbBatchedBridge) {
        const bridge = (global as any).__fbBatchedBridge;
        
        if (bridge && bridge.callFunctionReturnFlushedQueue) {
          this.originalBridgeCall = bridge.callFunctionReturnFlushedQueue;
          
          bridge.callFunctionReturnFlushedQueue = (...args: any[]) => {
            const startTime = Date.now();
            
            try {
              const result = this.originalBridgeCall!.apply(bridge, args);
              const endTime = Date.now();
              const duration = endTime - startTime;
              
              this.recordBridgeCall(duration, args);
              return result;
            } catch (error) {
              const endTime = Date.now();
              const duration = endTime - startTime;
              
              this.recordBridgeCall(duration, args, error);
              throw error;
            }
          };
        }

        // Intercept other bridge methods
        if (bridge && bridge.invokeCallbackAndReturnFlushedQueue) {
          const originalInvokeCallback = bridge.invokeCallbackAndReturnFlushedQueue;
          
          bridge.invokeCallbackAndReturnFlushedQueue = (...args: any[]) => {
            const startTime = Date.now();
            
            try {
              const result = originalInvokeCallback.apply(bridge, args);
              const endTime = Date.now();
              const duration = endTime - startTime;
              
              this.recordBridgeCallback(duration, args);
              return result;
            } catch (error) {
              const endTime = Date.now();
              const duration = endTime - startTime;
              
              this.recordBridgeCallback(duration, args, error);
              throw error;
            }
          };
        }
      }

      if (this.debugMode) {
        console.log('BridgePerformanceMonitor: Bridge interception setup complete');
      }
    } catch (error) {
      if (this.debugMode) {
        console.warn('BridgePerformanceMonitor: Bridge interception setup failed:', error);
      }
    }
  }

  /**
   * Setup bridge queue monitoring
   */
  private setupBridgeQueueMonitoring(): void {
    try {
      // Monitor bridge message queue if available
      if (typeof global !== 'undefined' && (global as any).__fbBatchedBridge) {
        const bridge = (global as any).__fbBatchedBridge;
        
        // Monitor queue size periodically
        setInterval(() => {
          this.monitorBridgeQueue(bridge);
        }, 1000); // Check every second
      }
    } catch (error) {
      if (this.debugMode) {
        console.warn('BridgePerformanceMonitor: Bridge queue monitoring setup failed:', error);
      }
    }
  }

  /**
   * Monitor bridge queue size and performance
   */
  private monitorBridgeQueue(bridge: any): void {
    try {
      // Estimate queue size (this is implementation-specific)
      let queueSize = 0;
      
      if (bridge._queue && Array.isArray(bridge._queue)) {
        queueSize = bridge._queue.length;
      } else if (bridge._callbackID) {
        // Estimate based on callback ID
        queueSize = Math.max(0, bridge._callbackID - this.bridgeCallCount);
      }

      this.bridgeMetrics.bridgeQueueSize = queueSize;

      // Emit queue size metric
      if (this.onPerformanceEvent) {
        this.emitPerformanceEvent('bridge_queue_size', queueSize, 'count');
      }

      if (this.debugMode && queueSize > 10) {
        console.warn('BridgePerformanceMonitor: Large bridge queue detected:', queueSize);
      }
    } catch (error) {
      if (this.debugMode) {
        console.warn('BridgePerformanceMonitor: Bridge queue monitoring failed:', error);
      }
    }
  }

  /**
   * Record bridge call performance
   */
  private recordBridgeCall(duration: number, args: any[], error?: any): void {
    this.bridgeCallCount++;
    this.bridgeCallTimes.push(duration);

    // Keep only recent call times
    if (this.bridgeCallTimes.length > this.maxCallTimeHistory) {
      this.bridgeCallTimes.shift();
    }

    // Check for slow bridge calls
    if (duration > this.bridgeCallTimeThreshold) {
      this.handleSlowBridgeCall(duration, args, error);
    }

    if (this.debugMode && duration > 50) {
      console.log('BridgePerformanceMonitor: Bridge call took', duration, 'ms');
    }
  }

  /**
   * Record bridge callback performance
   */
  private recordBridgeCallback(duration: number, args: any[], error?: any): void {
    // Similar to bridge call but for callbacks
    this.recordBridgeCall(duration, args, error);
  }

  /**
   * Handle slow bridge calls
   */
  private handleSlowBridgeCall(duration: number, args: any[], error?: any): void {
    const slowCallEvent = {
      name: 'slow_bridge_call',
      entryType: 'measure',
      startTime: Date.now() - duration,
      duration,
      category: 'bridge' as const,
      attributes: {
        call_duration: duration,
        threshold: this.bridgeCallTimeThreshold,
        has_error: !!error,
        args_count: args.length,
        error_message: error?.message || null
      }
    };

    if (this.onPerformanceEvent) {
      this.onPerformanceEvent([slowCallEvent]);
    }

    if (this.debugMode) {
      console.warn('BridgePerformanceMonitor: Slow bridge call detected:', duration, 'ms');
    }
  }

  /**
   * Start periodic bridge metrics collection
   */
  private startPeriodicMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    this.monitoringInterval = setInterval(() => {
      this.collectBridgeMetrics();
    }, this.monitoringIntervalMs);

    if (this.debugMode) {
      console.log('BridgePerformanceMonitor: Started periodic monitoring every', this.monitoringIntervalMs, 'ms');
    }
  }

  /**
   * Collect current bridge performance metrics
   */
  private collectBridgeMetrics(): void {
    try {
      const currentTime = Date.now();
      const timeSinceLastCheck = currentTime - this.lastBridgeCheck;

      // Calculate bridge metrics
      this.calculateBridgeMetrics(timeSinceLastCheck);

      // Emit performance events
      this.emitBridgeEvents();

      this.lastBridgeCheck = currentTime;

      if (this.debugMode) {
        console.log('BridgePerformanceMonitor: Bridge metrics collected:', this.bridgeMetrics);
      }
    } catch (error) {
      if (this.debugMode) {
        console.error('BridgePerformanceMonitor: Failed to collect bridge metrics:', error);
      }
    }
  }

  /**
   * Calculate bridge performance metrics
   */
  private calculateBridgeMetrics(timePeriodMs: number): void {
    // Bridge call count
    this.bridgeMetrics.bridgeCallCount = this.bridgeCallCount;

    // Average bridge call time
    if (this.bridgeCallTimes.length > 0) {
      const totalTime = this.bridgeCallTimes.reduce((sum, time) => sum + time, 0);
      this.bridgeMetrics.averageBridgeCallTime = totalTime / this.bridgeCallTimes.length;
    }

    // Maximum bridge call time
    if (this.bridgeCallTimes.length > 0) {
      this.bridgeMetrics.maxBridgeCallTime = Math.max(...this.bridgeCallTimes);
    }

    // Bridge calls per second
    if (timePeriodMs > 0) {
      const callsInPeriod = this.bridgeCallTimes.length;
      this.bridgeMetrics.bridgeCallsPerSecond = (callsInPeriod / timePeriodMs) * 1000;
    }
  }

  /**
   * Emit bridge performance events
   */
  private emitBridgeEvents(): void {
    if (!this.onPerformanceEvent) {
      return;
    }

    // Emit individual bridge metrics
    if (this.bridgeMetrics.bridgeCallCount !== undefined) {
      this.emitPerformanceEvent('bridge_call_count', this.bridgeMetrics.bridgeCallCount, 'count');
    }

    if (this.bridgeMetrics.averageBridgeCallTime !== undefined) {
      this.emitPerformanceEvent('bridge_avg_call_time', this.bridgeMetrics.averageBridgeCallTime, 'ms');
    }

    if (this.bridgeMetrics.maxBridgeCallTime !== undefined) {
      this.emitPerformanceEvent('bridge_max_call_time', this.bridgeMetrics.maxBridgeCallTime, 'ms');
    }

    if (this.bridgeMetrics.bridgeCallsPerSecond !== undefined) {
      this.emitPerformanceEvent('bridge_calls_per_second', this.bridgeMetrics.bridgeCallsPerSecond, 'calls/sec');
    }

    if (this.bridgeMetrics.bridgeQueueSize !== undefined) {
      this.emitPerformanceEvent('bridge_queue_size', this.bridgeMetrics.bridgeQueueSize, 'count');
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
      category: 'bridge' as const,
      attributes: {
        unit,
        value,
        timestamp: Date.now()
      }
    };

    this.onPerformanceEvent([performanceEntry]);
  }

  /**
   * Force bridge metrics collection
   */
  forceBridgeMetricsCollection(): void {
    this.collectBridgeMetrics();
  }

  /**
   * Get current bridge metrics
   */
  getBridgeMetrics(): Partial<BridgeMetrics> {
    return { ...this.bridgeMetrics };
  }

  /**
   * Get bridge call statistics
   */
  getBridgeCallStats(): {
    totalCalls: number;
    recentCallTimes: number[];
    averageTime: number;
    maxTime: number;
    callsPerSecond: number;
  } {
    return {
      totalCalls: this.bridgeCallCount,
      recentCallTimes: [...this.bridgeCallTimes],
      averageTime: this.bridgeMetrics.averageBridgeCallTime || 0,
      maxTime: this.bridgeMetrics.maxBridgeCallTime || 0,
      callsPerSecond: this.bridgeMetrics.bridgeCallsPerSecond || 0
    };
  }

  /**
   * Reset bridge call statistics
   */
  resetBridgeStats(): void {
    this.bridgeCallCount = 0;
    this.bridgeCallTimes = [];
    this.bridgeMetrics = {};

    if (this.debugMode) {
      console.log('BridgePerformanceMonitor: Bridge statistics reset');
    }
  }

  /**
   * Update monitoring configuration
   */
  updateConfig(config: {
    monitoringInterval?: number;
    bridgeCallTimeThreshold?: number;
    enableBridgeCallTracking?: boolean;
    maxCallTimeHistory?: number;
  }): void {
    if (config.monitoringInterval !== undefined) {
      this.monitoringIntervalMs = config.monitoringInterval;
      if (this.isInitialized) {
        this.startPeriodicMonitoring(); // Restart with new interval
      }
    }

    if (config.bridgeCallTimeThreshold !== undefined) {
      this.bridgeCallTimeThreshold = config.bridgeCallTimeThreshold;
    }

    if (config.enableBridgeCallTracking !== undefined) {
      this.enableBridgeCallTracking = config.enableBridgeCallTracking;
    }

    if (config.maxCallTimeHistory !== undefined) {
      this.maxCallTimeHistory = config.maxCallTimeHistory;
    }

    if (this.debugMode) {
      console.log('BridgePerformanceMonitor: Configuration updated:', config);
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
      metrics: this.bridgeMetrics,
      callStats: this.getBridgeCallStats(),
      config: {
        monitoringInterval: this.monitoringIntervalMs,
        bridgeCallTimeThreshold: this.bridgeCallTimeThreshold,
        enableBridgeCallTracking: this.enableBridgeCallTracking,
        maxCallTimeHistory: this.maxCallTimeHistory
      },
      lastCheck: this.lastBridgeCheck,
      debugMode: this.debugMode
    };
  }

  /**
   * Dispose of bridge performance monitoring
   */
  dispose(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }

    // Restore original bridge methods
    if (this.originalBridgeCall && typeof global !== 'undefined' && (global as any).__fbBatchedBridge) {
      const bridge = (global as any).__fbBatchedBridge;
      if (bridge && bridge.callFunctionReturnFlushedQueue) {
        bridge.callFunctionReturnFlushedQueue = this.originalBridgeCall;
      }
    }

    this.isInitialized = false;
    this.bridgeMetrics = {};
    this.bridgeCallTimes = [];
    this.bridgeCallCount = 0;
    this.onPerformanceEvent = undefined;

    if (this.debugMode) {
      console.log('BridgePerformanceMonitor: Disposed');
    }
  }
}
