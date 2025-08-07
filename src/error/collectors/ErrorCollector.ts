import type { ErrorEvent, ErrorTelemetryAttributes, ManualErrorOptions, ErrorSource, ErrorHandling, ErrorSeverity } from '../types/ErrorTypes';
import type { TelemetryEvent } from '../../core/models/TelemetryEvent';

/**
 * ErrorCollector - Main error collection and formatting
 * Processes and formats errors for telemetry matching Flutter exactly
 */
export class ErrorCollector {
  private onTelemetryEvent: (event: TelemetryEvent) => void;
  private debugMode = false;
  private maxStackTraceLength = 10000;

  constructor(onTelemetryEvent: (event: TelemetryEvent) => void, debugMode = false) {
    this.onTelemetryEvent = onTelemetryEvent;
    this.debugMode = debugMode;
  }

  /**
   * Process and send error event
   */
  processErrorEvent(errorEvent: ErrorEvent): void {
    try {
      // Create telemetry event matching Flutter format
      const telemetryEvent = this.createErrorTelemetryEvent(errorEvent);
      
      // Send telemetry event
      this.onTelemetryEvent(telemetryEvent);

      if (this.debugMode) {
        console.log('ErrorCollector: Processed error event:', telemetryEvent);
      }
    } catch (error) {
      if (this.debugMode) {
        console.error('ErrorCollector: Error processing error event:', error);
      }
    }
  }

  /**
   * Track manual error
   */
  trackManualError(options: ManualErrorOptions): void {
    try {
      const errorEvent: ErrorEvent = {
        type: 'manual' as ErrorSource,
        message: options.message,
        timestamp: Date.now(),
        hasStackTrace: !!options.stackTrace,
        stackTrace: options.stackTrace,
        handling: options.handling || 'handled' as ErrorHandling,
        severity: options.severity || 'non_fatal' as ErrorSeverity,
        errorClass: options.errorClass || 'ManualError',
        context: options.context
      };

      this.processErrorEvent(errorEvent);

      if (this.debugMode) {
        console.log('ErrorCollector: Tracked manual error:', errorEvent);
      }
    } catch (error) {
      if (this.debugMode) {
        console.error('ErrorCollector: Error tracking manual error:', error);
      }
    }
  }

  /**
   * Create error telemetry event matching Flutter format exactly
   */
  private createErrorTelemetryEvent(errorEvent: ErrorEvent): TelemetryEvent {
    const attributes: Record<string, string> = {
      'error.type': errorEvent.type,
      'error.message': errorEvent.message,
      'error.timestamp': errorEvent.timestamp.toString(),
      'error.has_stack_trace': errorEvent.hasStackTrace.toString(),
      'error.handling': errorEvent.handling,
      'error.severity': errorEvent.severity
    };

    // Add stack trace if available and within length limit
    if (errorEvent.stackTrace) {
      let stackTrace = errorEvent.stackTrace;
      if (stackTrace.length > this.maxStackTraceLength) {
        stackTrace = stackTrace.substring(0, this.maxStackTraceLength) + '... (truncated)';
      }
      attributes['error.stack_trace'] = stackTrace;
    }

    // Add error class if available
    if (errorEvent.errorClass) {
      attributes['error.class'] = errorEvent.errorClass;
    }

    // Add context as JSON string if available
    if (errorEvent.context) {
      try {
        attributes['error.context'] = JSON.stringify(errorEvent.context);
      } catch (jsonError) {
        if (this.debugMode) {
          console.warn('ErrorCollector: Failed to stringify error context:', jsonError);
        }
        attributes['error.context'] = String(errorEvent.context);
      }
    }

    return {
      id: this.generateEventId(),
      sessionId: '', // Will be set by EdgeTelemetry
      eventName: 'error.occurred',
      timestamp: new Date(errorEvent.timestamp),
      attributes: attributes
    };
  }

  /**
   * Set maximum stack trace length
   */
  setMaxStackTraceLength(length: number): void {
    this.maxStackTraceLength = Math.max(0, length);
    
    if (this.debugMode) {
      console.log('ErrorCollector: Set max stack trace length to:', this.maxStackTraceLength);
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): Record<string, any> {
    return {
      maxStackTraceLength: this.maxStackTraceLength,
      debugMode: this.debugMode
    };
  }

  /**
   * Extract and clean stack trace
   */
  private extractStackTrace(error: Error): string | undefined {
    if (!error.stack) {
      return undefined;
    }

    try {
      // Clean up stack trace for better readability
      let stackTrace = error.stack;
      
      // Remove common noise from React Native stack traces
      const linesToFilter = [
        /at Object\.require \(/,
        /at __webpack_require__ \(/,
        /at Module\._compile \(/,
        /at Object\.Module\._extensions/,
        /at Module\.load \(/,
        /at Function\.Module\._load \(/,
        /at Function\.executeUserEntryPoint/
      ];

      const lines = stackTrace.split('\n').filter(line => {
        return !linesToFilter.some(pattern => pattern.test(line));
      });

      return lines.join('\n').trim();
    } catch (cleanupError) {
      if (this.debugMode) {
        console.warn('ErrorCollector: Failed to clean stack trace:', cleanupError);
      }
      return error.stack;
    }
  }

  /**
   * Generate a unique event ID
   */
  private generateEventId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 10);
    return `error_${timestamp}_${random}`;
  }
}
