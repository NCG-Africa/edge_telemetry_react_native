import type { TelemetryEvent } from '../core/models/TelemetryEvent';
import type { 
  PerformanceConfig, 
  PerformanceMonitorStatus,
  ManualPerformanceOptions,
  PerformanceTimingEntry
} from './types/PerformanceTypes';
import { StartupTimeMonitor } from './monitors/StartupTimeMonitor';
import { MemoryMonitor } from './monitors/MemoryMonitor';
import { BridgePerformanceMonitor } from './monitors/BridgePerformanceMonitor';
import { BundleMetricsMonitor } from './monitors/BundleMetricsMonitor';
import { PerformanceCollector } from './collectors/PerformanceCollector';

/**
 * PerformanceMonitorManager - Main coordinator for all performance monitors
 * Phase 10: Performance Monitoring
 */
export class PerformanceMonitorManager {
  private performanceCollector: PerformanceCollector;
  private startupTimeMonitor?: StartupTimeMonitor;
  private memoryMonitor?: MemoryMonitor;
  private bridgePerformanceMonitor?: BridgePerformanceMonitor;
  private bundleMetricsMonitor?: BundleMetricsMonitor;
  private config: PerformanceConfig;
  private isInitialized = false;
  private performanceStats: Record<string, any> = {};

  constructor(
    onTelemetryEvent: (event: TelemetryEvent) => void,
    config: Partial<PerformanceConfig> = {}
  ) {
    // Set default configuration
    this.config = {
      enableStartupMonitoring: true,
      enableMemoryMonitoring: true,
      enableBridgeMonitoring: true,
      enableBundleMonitoring: true,
      enableRenderMonitoring: false, // Not implemented yet
      enableNetworkMonitoring: false, // Handled by NetworkMonitorManager
      
      // Monitoring intervals (in milliseconds)
      memoryMonitoringInterval: 30000, // 30 seconds
      bridgeMonitoringInterval: 10000, // 10 seconds
      
      // Thresholds
      memoryWarningThreshold: 100, // MB
      bridgeCallTimeThreshold: 100, // ms
      renderTimeThreshold: 16, // ms (60 FPS)
      
      // Sampling
      performanceSampleRate: 1.0, // 100% sampling by default
      enablePerformanceTracing: true,
      
      // Debug
      debugMode: false,
      ...config
    };

    // Initialize performance collector
    this.performanceCollector = new PerformanceCollector(
      onTelemetryEvent,
      this.config.debugMode
    );

    if (this.config.debugMode) {
      console.log('PerformanceMonitorManager: Initialized with config:', this.config);
    }
  }

  /**
   * Initialize performance monitoring
   */
  initialize(): void {
    if (this.isInitialized) {
      if (this.config.debugMode) {
        console.warn('PerformanceMonitorManager: Already initialized');
      }
      return;
    }

    try {
      // Initialize startup monitoring
      if (this.config.enableStartupMonitoring) {
        this.startupTimeMonitor = StartupTimeMonitor.getInstance(
          (entries) => this.handlePerformanceEntries(entries),
          this.config.debugMode
        );
        this.startupTimeMonitor.initialize();
        
        if (this.config.debugMode) {
          console.log('PerformanceMonitorManager: Startup monitoring initialized');
        }
      }

      // Initialize memory monitoring
      if (this.config.enableMemoryMonitoring) {
        this.memoryMonitor = new MemoryMonitor(
          (entries) => this.handlePerformanceEntries(entries),
          this.config.debugMode,
          {
            monitoringInterval: this.config.memoryMonitoringInterval,
            memoryWarningThreshold: this.config.memoryWarningThreshold,
            enableMemoryWarnings: true
          }
        );
        this.memoryMonitor.initialize();
        
        if (this.config.debugMode) {
          console.log('PerformanceMonitorManager: Memory monitoring initialized');
        }
      }

      // Initialize bridge performance monitoring
      if (this.config.enableBridgeMonitoring) {
        this.bridgePerformanceMonitor = new BridgePerformanceMonitor(
          (entries) => this.handlePerformanceEntries(entries),
          this.config.debugMode,
          {
            monitoringInterval: this.config.bridgeMonitoringInterval,
            bridgeCallTimeThreshold: this.config.bridgeCallTimeThreshold,
            enableBridgeCallTracking: true
          }
        );
        this.bridgePerformanceMonitor.initialize();
        
        if (this.config.debugMode) {
          console.log('PerformanceMonitorManager: Bridge performance monitoring initialized');
        }
      }

      // Initialize bundle metrics monitoring
      if (this.config.enableBundleMonitoring) {
        this.bundleMetricsMonitor = new BundleMetricsMonitor(
          (entries) => this.handlePerformanceEntries(entries),
          this.config.debugMode
        );
        this.bundleMetricsMonitor.initialize();
        
        if (this.config.debugMode) {
          console.log('PerformanceMonitorManager: Bundle metrics monitoring initialized');
        }
      }

      // Setup periodic performance summaries
      this.setupPerformanceSummaries();

      this.isInitialized = true;

      if (this.config.debugMode) {
        console.log('PerformanceMonitorManager: Performance monitoring initialized');
      }
    } catch (error) {
      if (this.config.debugMode) {
        console.error('PerformanceMonitorManager: Failed to initialize performance monitoring:', error);
      }
      throw error;
    }
  }

  /**
   * Handle performance entries from monitors
   */
  private handlePerformanceEntries(entries: PerformanceTimingEntry[]): void {
    if (!this.isInitialized || !entries.length) {
      return;
    }

    try {
      // Apply sampling rate
      if (this.config.performanceSampleRate < 1.0) {
        const sampledEntries = entries.filter(() => 
          Math.random() < this.config.performanceSampleRate
        );
        if (sampledEntries.length === 0) {
          return;
        }
        entries = sampledEntries;
      }

      // Process entries through performance collector
      this.performanceCollector.processPerformanceEntries(entries);

      // Update performance statistics
      this.updatePerformanceStats(entries);

      if (this.config.debugMode) {
        console.log(`PerformanceMonitorManager: Processed ${entries.length} performance entries`);
      }
    } catch (error) {
      if (this.config.debugMode) {
        console.error('PerformanceMonitorManager: Error processing performance entries:', error);
      }
    }
  }

  /**
   * Track manual performance metric
   */
  trackManualPerformance(options: ManualPerformanceOptions): void {
    if (!this.isInitialized) {
      if (this.config.debugMode) {
        console.warn('PerformanceMonitorManager: Not initialized, cannot track manual performance');
      }
      return;
    }

    this.performanceCollector.trackManualPerformance(options);
  }

  /**
   * Update performance statistics
   */
  private updatePerformanceStats(entries: PerformanceTimingEntry[]): void {
    try {
      for (const entry of entries) {
        const category = entry.category;
        
        if (!this.performanceStats[category]) {
          this.performanceStats[category] = {
            count: 0,
            totalDuration: 0,
            averageDuration: 0,
            maxDuration: 0,
            minDuration: Number.MAX_VALUE
          };
        }

        const stats = this.performanceStats[category];
        const duration = entry.duration || 0;

        stats.count++;
        stats.totalDuration += duration;
        stats.averageDuration = stats.totalDuration / stats.count;
        stats.maxDuration = Math.max(stats.maxDuration, duration);
        stats.minDuration = Math.min(stats.minDuration, duration);
      }
    } catch (error) {
      if (this.config.debugMode) {
        console.error('PerformanceMonitorManager: Error updating performance stats:', error);
      }
    }
  }

  /**
   * Setup periodic performance summaries
   */
  private setupPerformanceSummaries(): void {
    if (!this.config.enablePerformanceTracing) {
      return;
    }

    // Create performance summaries every 5 minutes
    setInterval(() => {
      this.createPerformanceSummaries();
    }, 5 * 60 * 1000); // 5 minutes
  }

  /**
   * Create performance summaries for all categories
   */
  private createPerformanceSummaries(): void {
    try {
      for (const [category, stats] of Object.entries(this.performanceStats)) {
        if (stats.count > 0) {
          const summaryMetrics = {
            count: stats.count,
            total_duration: stats.totalDuration,
            average_duration: stats.averageDuration,
            max_duration: stats.maxDuration,
            min_duration: stats.minDuration === Number.MAX_VALUE ? 0 : stats.minDuration
          };

          this.performanceCollector.createPerformanceSummary(
            category as any,
            summaryMetrics,
            5 * 60 * 1000 // 5 minutes in ms
          );
        }
      }

      // Reset stats after summary
      this.performanceStats = {};

      if (this.config.debugMode) {
        console.log('PerformanceMonitorManager: Performance summaries created');
      }
    } catch (error) {
      if (this.config.debugMode) {
        console.error('PerformanceMonitorManager: Error creating performance summaries:', error);
      }
    }
  }

  /**
   * Force collection of all performance metrics
   */
  forcePerformanceCollection(): void {
    try {
      if (this.memoryMonitor) {
        this.memoryMonitor.forceMemoryCollection();
      }

      if (this.bridgePerformanceMonitor) {
        this.bridgePerformanceMonitor.forceBridgeMetricsCollection();
      }

      if (this.bundleMetricsMonitor) {
        this.bundleMetricsMonitor.forceBundleMetricsCollection();
      }

      if (this.config.debugMode) {
        console.log('PerformanceMonitorManager: Forced performance collection completed');
      }
    } catch (error) {
      if (this.config.debugMode) {
        console.error('PerformanceMonitorManager: Error during forced collection:', error);
      }
    }
  }

  /**
   * Get comprehensive performance metrics
   */
  getPerformanceMetrics(): Record<string, any> {
    const metrics: Record<string, any> = {};

    try {
      if (this.startupTimeMonitor) {
        metrics.startup = this.startupTimeMonitor.getStartupMetrics();
      }

      if (this.memoryMonitor) {
        metrics.memory = this.memoryMonitor.getMemoryMetrics();
      }

      if (this.bridgePerformanceMonitor) {
        metrics.bridge = this.bridgePerformanceMonitor.getBridgeMetrics();
      }

      if (this.bundleMetricsMonitor) {
        metrics.bundle = this.bundleMetricsMonitor.getBundleMetrics();
      }

      metrics.statistics = { ...this.performanceStats };
    } catch (error) {
      if (this.config.debugMode) {
        console.error('PerformanceMonitorManager: Error getting performance metrics:', error);
      }
    }

    return metrics;
  }

  /**
   * Get performance monitoring status
   */
  getStatus(): PerformanceMonitorStatus {
    const activeMonitors: string[] = [];

    if (this.startupTimeMonitor?.isActive()) activeMonitors.push('startup');
    if (this.memoryMonitor?.isActive()) activeMonitors.push('memory');
    if (this.bridgePerformanceMonitor?.isActive()) activeMonitors.push('bridge');
    if (this.bundleMetricsMonitor?.isActive()) activeMonitors.push('bundle');

    return {
      initialized: this.isInitialized,
      activeMonitors,
      config: this.config,
      metrics: this.getPerformanceMetrics(),
      lastUpdated: new Date()
    };
  }

  /**
   * Update performance monitoring configuration
   */
  updateConfig(newConfig: Partial<PerformanceConfig>): void {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...newConfig };

    // Update individual monitor configurations
    if (this.memoryMonitor && (
      newConfig.memoryMonitoringInterval !== undefined ||
      newConfig.memoryWarningThreshold !== undefined
    )) {
      this.memoryMonitor.updateConfig({
        monitoringInterval: newConfig.memoryMonitoringInterval,
        memoryWarningThreshold: newConfig.memoryWarningThreshold
      });
    }

    if (this.bridgePerformanceMonitor && (
      newConfig.bridgeMonitoringInterval !== undefined ||
      newConfig.bridgeCallTimeThreshold !== undefined
    )) {
      this.bridgePerformanceMonitor.updateConfig({
        monitoringInterval: newConfig.bridgeMonitoringInterval,
        bridgeCallTimeThreshold: newConfig.bridgeCallTimeThreshold
      });
    }

    // Update performance collector debug mode
    if (newConfig.debugMode !== undefined) {
      this.performanceCollector.setDebugMode(newConfig.debugMode);
    }

    if (this.config.debugMode) {
      console.log('PerformanceMonitorManager: Configuration updated:', newConfig);
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): PerformanceConfig {
    return { ...this.config };
  }

  /**
   * Clear performance statistics
   */
  clearPerformanceStats(): void {
    this.performanceStats = {};
    
    if (this.config.debugMode) {
      console.log('PerformanceMonitorManager: Performance statistics cleared');
    }
  }

  /**
   * Check if performance monitoring is active
   */
  isActive(): boolean {
    return this.isInitialized;
  }

  /**
   * Dispose of performance monitoring and clean up resources
   */
  dispose(): void {
    if (!this.isInitialized) {
      return;
    }

    try {
      // Dispose of individual monitors
      if (this.startupTimeMonitor) {
        this.startupTimeMonitor.dispose();
        this.startupTimeMonitor = undefined;
      }

      if (this.memoryMonitor) {
        this.memoryMonitor.dispose();
        this.memoryMonitor = undefined;
      }

      if (this.bridgePerformanceMonitor) {
        this.bridgePerformanceMonitor.dispose();
        this.bridgePerformanceMonitor = undefined;
      }

      if (this.bundleMetricsMonitor) {
        this.bundleMetricsMonitor.dispose();
        this.bundleMetricsMonitor = undefined;
      }

      // Clear performance statistics
      this.performanceStats = {};

      this.isInitialized = false;

      if (this.config.debugMode) {
        console.log('PerformanceMonitorManager: Disposed');
      }
    } catch (error) {
      if (this.config.debugMode) {
        console.error('PerformanceMonitorManager: Error during disposal:', error);
      }
    }
  }
}
