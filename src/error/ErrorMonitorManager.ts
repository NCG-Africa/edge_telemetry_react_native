import type { TelemetryEvent } from '../core/models/TelemetryEvent';
import type { ErrorConfig, ManualErrorOptions } from './types/ErrorTypes';
import { JavaScriptErrorHandler } from './handlers/JavaScriptErrorHandler';
import { PromiseRejectionHandler } from './handlers/PromiseRejectionHandler';
import { ErrorCollector } from './collectors/ErrorCollector';

/**
 * ErrorMonitorManager - Main coordinator for all error handlers
 * Manages JavaScript errors, promise rejections, and provides manual error tracking
 */
export class ErrorMonitorManager {
  private errorCollector: ErrorCollector;
  private javaScriptErrorHandler: JavaScriptErrorHandler;
  private promiseRejectionHandler: PromiseRejectionHandler;
  private config: ErrorConfig;
  private isInitialized = false;
  private errorCounts: Record<string, number> = {};

  constructor(
    onTelemetryEvent: (event: TelemetryEvent) => void,
    config: Partial<ErrorConfig> = {}
  ) {
    // Set default configuration
    this.config = {
      enableJavaScriptErrors: true,
      enablePromiseRejections: true,
      enableReactErrors: true,
      enableNativeErrors: false, // Not implemented yet
      captureStackTraces: true,
      maxStackTraceLength: 10000,
      debugMode: false,
      ...config
    };

    // Initialize error collector
    this.errorCollector = new ErrorCollector(
      onTelemetryEvent,
      this.config.debugMode
    );

    // Initialize error handlers
    this.javaScriptErrorHandler = new JavaScriptErrorHandler(
      (errorEvent) => {
        this.handleErrorEvent(errorEvent);
        this.errorCollector.processErrorEvent(errorEvent);
      },
      this.config.debugMode
    );

    this.promiseRejectionHandler = new PromiseRejectionHandler(
      (errorEvent) => {
        this.handleErrorEvent(errorEvent);
        this.errorCollector.processErrorEvent(errorEvent);
      },
      this.config.debugMode
    );

    // Set stack trace length limit
    this.errorCollector.setMaxStackTraceLength(this.config.maxStackTraceLength);

    if (this.config.debugMode) {
      console.log('ErrorMonitorManager: Initialized with config:', this.config);
    }
  }

  /**
   * Initialize error monitoring
   */
  initialize(): void {
    if (this.isInitialized) {
      if (this.config.debugMode) {
        console.warn('ErrorMonitorManager: Already initialized');
      }
      return;
    }

    try {
      // Initialize JavaScript error handling
      if (this.config.enableJavaScriptErrors) {
        this.javaScriptErrorHandler.initialize();
        if (this.config.debugMode) {
          console.log('ErrorMonitorManager: JavaScript error handling initialized');
        }
      }

      // Initialize promise rejection handling
      if (this.config.enablePromiseRejections) {
        this.promiseRejectionHandler.initialize();
        if (this.config.debugMode) {
          console.log('ErrorMonitorManager: Promise rejection handling initialized');
        }
      }

      this.isInitialized = true;

      if (this.config.debugMode) {
        console.log('ErrorMonitorManager: Error monitoring initialized');
      }
    } catch (error) {
      if (this.config.debugMode) {
        console.error('ErrorMonitorManager: Failed to initialize error monitoring:', error);
      }
      throw error;
    }
  }

  /**
   * Track manual error
   */
  trackManualError(options: ManualErrorOptions): void {
    if (!this.isInitialized) {
      if (this.config.debugMode) {
        console.warn('ErrorMonitorManager: Not initialized, cannot track manual error');
      }
      return;
    }

    this.errorCollector.trackManualError(options);
  }

  /**
   * Track error from Error object
   */
  trackError(error: Error, context?: Record<string, any>): void {
    if (!this.isInitialized) {
      if (this.config.debugMode) {
        console.warn('ErrorMonitorManager: Not initialized, cannot track error');
      }
      return;
    }

    const options: ManualErrorOptions = {
      message: error.message || 'Unknown error',
      stackTrace: error.stack,
      errorClass: error.name || error.constructor?.name || 'Error',
      context: context,
      severity: 'non_fatal',
      handling: 'handled'
    };

    this.trackManualError(options);
  }

  /**
   * Handle error event and update statistics
   */
  private handleErrorEvent(errorEvent: any): void {
    try {
      // Update error counts
      const errorType = errorEvent.type || 'unknown';
      this.errorCounts[errorType] = (this.errorCounts[errorType] || 0) + 1;
      this.errorCounts['total'] = (this.errorCounts['total'] || 0) + 1;

      if (this.config.debugMode) {
        console.log(`ErrorMonitorManager: Error count updated - ${errorType}: ${this.errorCounts[errorType]}, total: ${this.errorCounts['total']}`);
      }
    } catch (error) {
      if (this.config.debugMode) {
        console.error('ErrorMonitorManager: Error updating error statistics:', error);
      }
    }
  }

  /**
   * Get error statistics
   */
  getErrorStats(): Record<string, number> {
    return { ...this.errorCounts };
  }

  /**
   * Clear error statistics
   */
  clearErrorStats(): void {
    this.errorCounts = {};
    
    if (this.config.debugMode) {
      console.log('ErrorMonitorManager: Error statistics cleared');
    }
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<ErrorConfig>): void {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...newConfig };

    // Update error collector configuration
    if (newConfig.maxStackTraceLength !== undefined) {
      this.errorCollector.setMaxStackTraceLength(newConfig.maxStackTraceLength);
    }

    // Reinitialize handlers if necessary
    if (this.isInitialized) {
      if (oldConfig.enableJavaScriptErrors !== this.config.enableJavaScriptErrors) {
        if (this.config.enableJavaScriptErrors) {
          this.javaScriptErrorHandler.initialize();
        } else {
          this.javaScriptErrorHandler.dispose();
        }
      }

      if (oldConfig.enablePromiseRejections !== this.config.enablePromiseRejections) {
        if (this.config.enablePromiseRejections) {
          this.promiseRejectionHandler.initialize();
        } else {
          this.promiseRejectionHandler.dispose();
        }
      }
    }

    if (this.config.debugMode) {
      console.log('ErrorMonitorManager: Configuration updated:', this.config);
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): ErrorConfig {
    return { ...this.config };
  }

  /**
   * Get error monitoring status
   */
  getStatus(): Record<string, any> {
    return {
      initialized: this.isInitialized,
      config: this.config,
      errorCounts: this.errorCounts,
      handlers: {
        javaScriptErrors: this.javaScriptErrorHandler.isActive(),
        promiseRejections: this.promiseRejectionHandler.isActive()
      }
    };
  }

  /**
   * Check if error monitoring is active
   */
  isActive(): boolean {
    return this.isInitialized;
  }

  /**
   * Dispose of error monitoring and clean up resources
   */
  dispose(): void {
    if (!this.isInitialized) {
      return;
    }

    try {
      // Dispose of error handlers
      this.javaScriptErrorHandler.dispose();
      this.promiseRejectionHandler.dispose();

      // Clear error statistics
      this.errorCounts = {};

      this.isInitialized = false;

      if (this.config.debugMode) {
        console.log('ErrorMonitorManager: Disposed');
      }
    } catch (error) {
      if (this.config.debugMode) {
        console.error('ErrorMonitorManager: Error during disposal:', error);
      }
    }
  }
}
