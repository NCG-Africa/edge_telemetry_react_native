import type { TelemetryEvent } from '../../core/models/TelemetryEvent';
import type { 
  PerformanceEvent, 
  PerformanceTimingEntry, 
  PerformanceTelemetryAttributes,
  PerformanceCategory,
  PerformanceMetricType,
  ManualPerformanceOptions
} from '../types/PerformanceTypes';

/**
 * PerformanceCollector - Processes and formats performance events into telemetry events
 * Phase 10: Performance Monitoring
 */
export class PerformanceCollector {
  private debugMode = false;
  private onTelemetryEvent: (event: TelemetryEvent) => void;

  constructor(
    onTelemetryEvent: (event: TelemetryEvent) => void,
    debugMode = false
  ) {
    this.onTelemetryEvent = onTelemetryEvent;
    this.debugMode = debugMode;
  }

  /**
   * Process performance timing entries and create telemetry events
   */
  processPerformanceEntries(entries: PerformanceTimingEntry[]): void {
    for (const entry of entries) {
      try {
        this.processPerformanceEntry(entry);
      } catch (error) {
        if (this.debugMode) {
          console.error('PerformanceCollector: Failed to process performance entry:', error, entry);
        }
      }
    }
  }

  /**
   * Process single performance entry
   */
  private processPerformanceEntry(entry: PerformanceTimingEntry): void {
    const telemetryEvent = this.createPerformanceTelemetryEvent(
      entry.category,
      entry.name,
      this.getMetricTypeFromEntry(entry),
      entry.duration || 0,
      this.getUnitFromEntry(entry),
      {
        ...entry.attributes,
        entry_type: entry.entryType,
        start_time: entry.startTime
      },
      entry.duration,
      entry.startTime,
      entry.startTime + (entry.duration || 0)
    );

    this.onTelemetryEvent(telemetryEvent);

    if (this.debugMode) {
      console.log('PerformanceCollector: Performance entry processed:', entry.name, entry.duration);
    }
  }

  /**
   * Track manual performance metric
   */
  trackManualPerformance(options: ManualPerformanceOptions): void {
    try {
      const telemetryEvent = this.createPerformanceTelemetryEvent(
        options.category,
        options.metricName,
        options.metricType,
        options.value,
        options.unit,
        options.attributes,
        options.duration,
        options.startTime,
        options.endTime
      );

      this.onTelemetryEvent(telemetryEvent);

      if (this.debugMode) {
        console.log('PerformanceCollector: Manual performance tracked:', options.metricName, options.value);
      }
    } catch (error) {
      if (this.debugMode) {
        console.error('PerformanceCollector: Failed to track manual performance:', error, options);
      }
    }
  }

  /**
   * Create performance telemetry event matching Flutter SDK structure
   */
  private createPerformanceTelemetryEvent(
    category: PerformanceCategory,
    metricName: string,
    metricType: PerformanceMetricType,
    value: number,
    unit: string,
    attributes?: Record<string, any>,
    duration?: number,
    startTime?: number,
    endTime?: number
  ): TelemetryEvent {
    // Create performance attributes matching Flutter SDK
    const performanceAttributes: PerformanceTelemetryAttributes = {
      'performance.category': category,
      'performance.metric_name': metricName,
      'performance.metric_type': metricType,
      'performance.value': String(value),
      'performance.unit': unit,
      'performance.platform': 'react-native',
      'performance.timestamp': String(Date.now())
    };

    // Add optional timing attributes
    if (duration !== undefined) {
      performanceAttributes['performance.duration'] = String(duration);
    }

    if (startTime !== undefined) {
      performanceAttributes['performance.start_time'] = String(startTime);
    }

    if (endTime !== undefined) {
      performanceAttributes['performance.end_time'] = String(endTime);
    }

    // Add device and app context
    performanceAttributes['performance.device_type'] = this.getDeviceType();
    
    // Add custom attributes
    if (attributes) {
      for (const [key, value] of Object.entries(attributes)) {
        if (value !== null && value !== undefined) {
          performanceAttributes[`performance.${key}`] = String(value);
        }
      }
    }

    // Create telemetry event with Flutter-compatible structure
    const telemetryEvent: TelemetryEvent = {
      id: this.generateEventId(),
      sessionId: '', // Will be set by the main SDK
      eventName: 'performance.metric',
      timestamp: new Date(),
      attributes: performanceAttributes,
      userId: '' // Will be set by the main SDK
    };

    return telemetryEvent;
  }

  /**
   * Get metric type from performance entry
   */
  private getMetricTypeFromEntry(entry: PerformanceTimingEntry): PerformanceMetricType {
    // Determine metric type based on entry characteristics
    if (entry.name.includes('time') || entry.name.includes('duration')) {
      return 'timer';
    } else if (entry.name.includes('count') || entry.name.includes('total')) {
      return 'counter';
    } else if (entry.name.includes('size') || entry.name.includes('memory')) {
      return 'gauge';
    } else if (entry.name.includes('rate') || entry.name.includes('distribution')) {
      return 'histogram';
    } else {
      return 'gauge'; // Default
    }
  }

  /**
   * Get unit from performance entry
   */
  private getUnitFromEntry(entry: PerformanceTimingEntry): string {
    const attributes = entry.attributes || {};
    
    if (attributes.unit) {
      return String(attributes.unit);
    }

    // Infer unit from metric name
    if (entry.name.includes('time') || entry.name.includes('duration')) {
      return 'ms';
    } else if (entry.name.includes('size') || entry.name.includes('memory')) {
      return 'bytes';
    } else if (entry.name.includes('count')) {
      return 'count';
    } else if (entry.name.includes('rate')) {
      return 'rate';
    } else {
      return 'unit';
    }
  }

  /**
   * Get device type for performance context
   */
  private getDeviceType(): string {
    try {
      // React Native device detection
      if (typeof global !== 'undefined' && (global as any).navigator) {
        const navigator = (global as any).navigator;
        
        if (navigator.product === 'ReactNative') {
          // Check for platform-specific indicators
          if (typeof global !== 'undefined' && (global as any).__turboModuleProxy) {
            return 'mobile'; // New Architecture
          } else {
            return 'mobile'; // Legacy Architecture
          }
        }
      }

      // Web detection
      if (typeof window !== 'undefined') {
        return 'web';
      }

      // Node.js detection
      if (typeof process !== 'undefined' && process.versions && process.versions.node) {
        return 'server';
      }

      return 'unknown';
    } catch (error) {
      if (this.debugMode) {
        console.warn('PerformanceCollector: Failed to detect device type:', error);
      }
      return 'unknown';
    }
  }

  /**
   * Create performance summary event
   */
  createPerformanceSummary(
    category: PerformanceCategory,
    metrics: Record<string, number>,
    timeWindow: number
  ): void {
    try {
      const summaryAttributes: PerformanceTelemetryAttributes = {
        'performance.category': category,
        'performance.metric_name': 'performance_summary',
        'performance.metric_type': 'histogram',
        'performance.value': String(Object.keys(metrics).length),
        'performance.unit': 'count',
        'performance.platform': 'react-native',
        'performance.timestamp': String(Date.now()),
        'performance.time_window': String(timeWindow)
      };

      // Add individual metrics as attributes
      for (const [metricName, value] of Object.entries(metrics)) {
        summaryAttributes[`performance.${metricName}`] = String(value);
      }

      const summaryEvent: TelemetryEvent = {
        id: this.generateEventId(),
        sessionId: '',
        eventName: 'performance.summary',
        timestamp: new Date(),
        attributes: summaryAttributes,
        userId: ''
      };

      this.onTelemetryEvent(summaryEvent);

      if (this.debugMode) {
        console.log('PerformanceCollector: Performance summary created for category:', category);
      }
    } catch (error) {
      if (this.debugMode) {
        console.error('PerformanceCollector: Failed to create performance summary:', error);
      }
    }
  }

  /**
   * Create performance threshold violation event
   */
  createThresholdViolationEvent(
    category: PerformanceCategory,
    metricName: string,
    actualValue: number,
    thresholdValue: number,
    unit: string,
    severity: 'warning' | 'critical' = 'warning'
  ): void {
    try {
      const violationAttributes: PerformanceTelemetryAttributes = {
        'performance.category': category,
        'performance.metric_name': 'threshold_violation',
        'performance.metric_type': 'counter',
        'performance.value': String(actualValue),
        'performance.unit': unit,
        'performance.platform': 'react-native',
        'performance.timestamp': String(Date.now()),
        'performance.violated_metric': metricName,
        'performance.threshold_value': String(thresholdValue),
        'performance.severity': severity,
        'performance.violation_ratio': String(actualValue / thresholdValue)
      };

      const violationEvent: TelemetryEvent = {
        id: this.generateEventId(),
        sessionId: '',
        eventName: 'performance.threshold_violation',
        timestamp: new Date(),
        attributes: violationAttributes,
        userId: ''
      };

      this.onTelemetryEvent(violationEvent);

      if (this.debugMode) {
        console.warn('PerformanceCollector: Threshold violation:', metricName, actualValue, '>', thresholdValue);
      }
    } catch (error) {
      if (this.debugMode) {
        console.error('PerformanceCollector: Failed to create threshold violation event:', error);
      }
    }
  }

  /**
   * Validate performance metric value
   */
  private validateMetricValue(value: number, metricName: string): boolean {
    // Check for valid numeric value
    if (typeof value !== 'number' || !isFinite(value) || isNaN(value)) {
      if (this.debugMode) {
        console.warn('PerformanceCollector: Invalid metric value:', metricName, value);
      }
      return false;
    }

    // Check for reasonable ranges
    if (value < 0) {
      if (this.debugMode) {
        console.warn('PerformanceCollector: Negative metric value:', metricName, value);
      }
      return false;
    }

    // Check for extremely large values (potential overflow)
    if (value > Number.MAX_SAFE_INTEGER) {
      if (this.debugMode) {
        console.warn('PerformanceCollector: Metric value too large:', metricName, value);
      }
      return false;
    }

    return true;
  }

  /**
   * Format metric value for telemetry
   */
  private formatMetricValue(value: number, unit: string): string {
    if (!this.validateMetricValue(value, 'format_check')) {
      return '0';
    }

    // Format based on unit
    switch (unit) {
      case 'ms':
        return value.toFixed(2);
      case 'bytes':
        return Math.round(value).toString();
      case 'count':
        return Math.round(value).toString();
      case 'ratio':
        return value.toFixed(4);
      case 'percentage':
        return (value * 100).toFixed(2);
      default:
        return value.toString();
    }
  }

  /**
   * Generate unique event ID
   */
  private generateEventId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 10);
    return `perf_${timestamp}_${random}`;
  }

  /**
   * Update debug mode
   */
  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
  }

  /**
   * Get collector status
   */
  getStatus(): Record<string, any> {
    return {
      debugMode: this.debugMode,
      hasEventHandler: !!this.onTelemetryEvent
    };
  }
}
