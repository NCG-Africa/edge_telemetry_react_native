import type { PerformanceEvent, StartupMetrics, PerformanceObserverCallback } from '../types/PerformanceTypes';

/**
 * StartupTimeMonitor - Tracks app startup performance metrics
 * Phase 10: Performance Monitoring
 */
export class StartupTimeMonitor {
  private static instance: StartupTimeMonitor;
  private isInitialized = false;
  private debugMode = false;
  private startupMetrics: Partial<StartupMetrics> = {};
  private startupTimestamps: Record<string, number> = {};
  private onPerformanceEvent?: PerformanceObserverCallback;

  // Startup phases
  private static readonly STARTUP_PHASES = {
    APP_START: 'app_start',
    JS_LOAD: 'js_load',
    BUNDLE_LOAD: 'bundle_load',
    NATIVE_INIT: 'native_init',
    FIRST_RENDER: 'first_render',
    TIME_TO_INTERACTIVE: 'time_to_interactive'
  } as const;

  constructor(onPerformanceEvent?: PerformanceObserverCallback, debugMode = false) {
    this.onPerformanceEvent = onPerformanceEvent;
    this.debugMode = debugMode;
    
    // Record app start time immediately
    this.recordAppStartTime();
  }

  /**
   * Get singleton instance
   */
  static getInstance(onPerformanceEvent?: PerformanceObserverCallback, debugMode = false): StartupTimeMonitor {
    if (!StartupTimeMonitor.instance) {
      StartupTimeMonitor.instance = new StartupTimeMonitor(onPerformanceEvent, debugMode);
    }
    return StartupTimeMonitor.instance;
  }

  /**
   * Initialize startup monitoring
   */
  initialize(): void {
    if (this.isInitialized) {
      if (this.debugMode) {
        console.warn('StartupTimeMonitor: Already initialized');
      }
      return;
    }

    try {
      // Record JS load start time
      this.recordTimestamp(StartupTimeMonitor.STARTUP_PHASES.JS_LOAD, Date.now());

      // Set up React Native performance observers if available
      this.setupReactNativeObservers();

      // Set up bundle load monitoring
      this.setupBundleLoadMonitoring();

      // Set up first render monitoring
      this.setupFirstRenderMonitoring();

      this.isInitialized = true;

      if (this.debugMode) {
        console.log('StartupTimeMonitor: Initialized');
      }
    } catch (error) {
      if (this.debugMode) {
        console.error('StartupTimeMonitor: Failed to initialize:', error);
      }
      throw error;
    }
  }

  /**
   * Record app start time (called immediately in constructor)
   */
  private recordAppStartTime(): void {
    const appStartTime = Date.now();
    this.recordTimestamp(StartupTimeMonitor.STARTUP_PHASES.APP_START, appStartTime);
    
    if (this.debugMode) {
      console.log('StartupTimeMonitor: App start time recorded:', appStartTime);
    }
  }

  /**
   * Record timestamp for startup phase
   */
  private recordTimestamp(phase: string, timestamp: number): void {
    this.startupTimestamps[phase] = timestamp;
    
    if (this.debugMode) {
      console.log(`StartupTimeMonitor: ${phase} timestamp:`, timestamp);
    }
  }

  /**
   * Setup React Native performance observers
   */
  private setupReactNativeObservers(): void {
    try {
      // Check if React Native performance API is available
      if (typeof global !== 'undefined' && (global as any).performance) {
        const performance = (global as any).performance;
        
        // Monitor performance marks and measures
        if (performance.getEntriesByType) {
          const entries = performance.getEntriesByType('navigation');
          if (entries.length > 0) {
            this.processNavigationEntries(entries);
          }
        }
      }

      // Monitor React Native bridge initialization
      this.monitorBridgeInitialization();
    } catch (error) {
      if (this.debugMode) {
        console.warn('StartupTimeMonitor: React Native observers setup failed:', error);
      }
    }
  }

  /**
   * Setup bundle load monitoring
   */
  private setupBundleLoadMonitoring(): void {
    try {
      // Record bundle load start
      this.recordTimestamp(StartupTimeMonitor.STARTUP_PHASES.BUNDLE_LOAD, Date.now());

      // Monitor when bundle loading completes
      const originalRequire = global.require;
      if (originalRequire) {
        global.require = (...args: any[]) => {
          const result = originalRequire.apply(global, args);
          
          // Check if this is the main bundle completion
          if (args[0] === 'react-native' || args[0] === './index') {
            this.recordBundleLoadComplete();
          }
          
          return result;
        };
      }
    } catch (error) {
      if (this.debugMode) {
        console.warn('StartupTimeMonitor: Bundle load monitoring setup failed:', error);
      }
    }
  }

  /**
   * Setup first render monitoring
   */
  private setupFirstRenderMonitoring(): void {
    try {
      // Use React DevTools profiler if available
      if (typeof global !== 'undefined' && (global as any).__REACT_DEVTOOLS_GLOBAL_HOOK__) {
        const hook = (global as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
        
        if (hook.onCommitFiberRoot) {
          const originalOnCommit = hook.onCommitFiberRoot;
          hook.onCommitFiberRoot = (id: any, root: any, ...args: any[]) => {
            // Record first render time
            if (!this.startupTimestamps[StartupTimeMonitor.STARTUP_PHASES.FIRST_RENDER]) {
              this.recordFirstRender();
            }
            
            return originalOnCommit.call(hook, id, root, ...args);
          };
        }
      }

      // Fallback: Use setTimeout to estimate first render
      setTimeout(() => {
        if (!this.startupTimestamps[StartupTimeMonitor.STARTUP_PHASES.FIRST_RENDER]) {
          this.recordFirstRender();
        }
      }, 100);
    } catch (error) {
      if (this.debugMode) {
        console.warn('StartupTimeMonitor: First render monitoring setup failed:', error);
      }
    }
  }

  /**
   * Monitor React Native bridge initialization
   */
  private monitorBridgeInitialization(): void {
    try {
      // Record native initialization time
      this.recordTimestamp(StartupTimeMonitor.STARTUP_PHASES.NATIVE_INIT, Date.now());
      
      // Monitor bridge ready state
      if (typeof global !== 'undefined' && (global as any).__fbBatchedBridge) {
        const bridge = (global as any).__fbBatchedBridge;
        
        if (bridge && typeof bridge.registerCallableModule === 'function') {
          // Bridge is ready
          this.calculateStartupMetrics();
        }
      }
    } catch (error) {
      if (this.debugMode) {
        console.warn('StartupTimeMonitor: Bridge monitoring failed:', error);
      }
    }
  }

  /**
   * Process navigation timing entries
   */
  private processNavigationEntries(entries: any[]): void {
    try {
      for (const entry of entries) {
        if (entry.loadEventEnd) {
          this.recordTimestamp('load_complete', entry.loadEventEnd);
        }
        if (entry.domContentLoadedEventEnd) {
          this.recordTimestamp('dom_ready', entry.domContentLoadedEventEnd);
        }
      }
    } catch (error) {
      if (this.debugMode) {
        console.warn('StartupTimeMonitor: Navigation entries processing failed:', error);
      }
    }
  }

  /**
   * Record bundle load completion
   */
  private recordBundleLoadComplete(): void {
    const bundleLoadTime = Date.now();
    this.recordTimestamp(`${StartupTimeMonitor.STARTUP_PHASES.BUNDLE_LOAD}_complete`, bundleLoadTime);
    
    // Calculate bundle load duration
    const startTime = this.startupTimestamps[StartupTimeMonitor.STARTUP_PHASES.BUNDLE_LOAD];
    if (startTime) {
      this.startupMetrics.bundleLoadTime = bundleLoadTime - startTime;
      this.emitPerformanceEvent('bundle_load_time', this.startupMetrics.bundleLoadTime, 'ms');
    }
  }

  /**
   * Record first render time
   */
  private recordFirstRender(): void {
    const firstRenderTime = Date.now();
    this.recordTimestamp(StartupTimeMonitor.STARTUP_PHASES.FIRST_RENDER, firstRenderTime);
    
    // Calculate first render duration
    const appStartTime = this.startupTimestamps[StartupTimeMonitor.STARTUP_PHASES.APP_START];
    if (appStartTime) {
      this.startupMetrics.firstRenderTime = firstRenderTime - appStartTime;
      this.emitPerformanceEvent('first_render_time', this.startupMetrics.firstRenderTime, 'ms');
    }

    // Set time to interactive (estimate)
    setTimeout(() => {
      this.recordTimeToInteractive();
    }, 500);
  }

  /**
   * Record time to interactive
   */
  private recordTimeToInteractive(): void {
    const interactiveTime = Date.now();
    this.recordTimestamp(StartupTimeMonitor.STARTUP_PHASES.TIME_TO_INTERACTIVE, interactiveTime);
    
    const appStartTime = this.startupTimestamps[StartupTimeMonitor.STARTUP_PHASES.APP_START];
    if (appStartTime) {
      this.startupMetrics.timeToInteractive = interactiveTime - appStartTime;
      this.emitPerformanceEvent('time_to_interactive', this.startupMetrics.timeToInteractive, 'ms');
    }

    // Calculate all startup metrics
    this.calculateStartupMetrics();
  }

  /**
   * Calculate all startup metrics
   */
  private calculateStartupMetrics(): void {
    const appStartTime = this.startupTimestamps[StartupTimeMonitor.STARTUP_PHASES.APP_START];
    const jsLoadTime = this.startupTimestamps[StartupTimeMonitor.STARTUP_PHASES.JS_LOAD];
    const nativeInitTime = this.startupTimestamps[StartupTimeMonitor.STARTUP_PHASES.NATIVE_INIT];

    if (appStartTime) {
      // App start time (total)
      const currentTime = Date.now();
      this.startupMetrics.appStartTime = currentTime - appStartTime;

      // JS load time
      if (jsLoadTime) {
        this.startupMetrics.jsLoadTime = jsLoadTime - appStartTime;
        this.emitPerformanceEvent('js_load_time', this.startupMetrics.jsLoadTime, 'ms');
      }

      // Native initialization time
      if (nativeInitTime) {
        this.startupMetrics.nativeInitTime = nativeInitTime - appStartTime;
        this.emitPerformanceEvent('native_init_time', this.startupMetrics.nativeInitTime, 'ms');
      }

      // Total app start time
      this.emitPerformanceEvent('app_start_time', this.startupMetrics.appStartTime, 'ms');

      if (this.debugMode) {
        console.log('StartupTimeMonitor: Startup metrics calculated:', this.startupMetrics);
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
      startTime: this.startupTimestamps[StartupTimeMonitor.STARTUP_PHASES.APP_START] || Date.now(),
      duration: value,
      category: 'startup' as const,
      attributes: {
        unit,
        phase: metricName,
        timestamp: Date.now()
      }
    };

    this.onPerformanceEvent([performanceEntry]);

    if (this.debugMode) {
      console.log('StartupTimeMonitor: Performance event emitted:', performanceEntry);
    }
  }

  /**
   * Get current startup metrics
   */
  getStartupMetrics(): Partial<StartupMetrics> {
    return { ...this.startupMetrics };
  }

  /**
   * Get startup timestamps
   */
  getStartupTimestamps(): Record<string, number> {
    return { ...this.startupTimestamps };
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
      metrics: this.startupMetrics,
      timestamps: this.startupTimestamps,
      debugMode: this.debugMode
    };
  }

  /**
   * Dispose of startup monitoring
   */
  dispose(): void {
    this.isInitialized = false;
    this.startupMetrics = {};
    this.startupTimestamps = {};
    this.onPerformanceEvent = undefined;

    if (this.debugMode) {
      console.log('StartupTimeMonitor: Disposed');
    }
  }
}
