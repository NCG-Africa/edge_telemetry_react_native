import type { ErrorEvent, ErrorSource, ErrorHandling, ErrorSeverity } from '../types/ErrorTypes';

/**
 * JavaScriptErrorHandler - Captures global JavaScript errors using React Native's ErrorUtils
 * Provides identical functionality to Flutter's global error handling
 */
export class JavaScriptErrorHandler {
  private onErrorEvent: (event: ErrorEvent) => void;
  private originalHandler?: (error: Error, isFatal?: boolean) => void;
  private isInitialized = false;
  private debugMode = false;

  constructor(onErrorEvent: (event: ErrorEvent) => void, debugMode = false) {
    this.onErrorEvent = onErrorEvent;
    this.debugMode = debugMode;
  }

  /**
   * Initialize JavaScript error handling
   */
  initialize(): void {
    if (this.isInitialized) {
      if (this.debugMode) {
        console.warn('JavaScriptErrorHandler: Already initialized');
      }
      return;
    }

    // Check if ErrorUtils is available (React Native environment)
    if (typeof ErrorUtils !== 'undefined') {
      // Store original handler
      this.originalHandler = ErrorUtils.getGlobalHandler();
      
      // Set our custom handler
      ErrorUtils.setGlobalHandler(this.handleJavaScriptError.bind(this));
      
      this.isInitialized = true;
      
      if (this.debugMode) {
        console.log('JavaScriptErrorHandler: Initialized with ErrorUtils');
      }
    } else {
      // Fallback for web or other environments
      this.initializeFallbackHandler();
      
      if (this.debugMode) {
        console.log('JavaScriptErrorHandler: Initialized with fallback handler');
      }
    }
  }

  /**
   * Initialize fallback error handler for non-React Native environments
   */
  private initializeFallbackHandler(): void {
    if (typeof window !== 'undefined') {
      // Browser environment
      window.addEventListener('error', this.handleWindowError.bind(this));
      this.isInitialized = true;
    } else if (typeof global !== 'undefined') {
      // Node.js-like environment
      process.on('uncaughtException', this.handleUncaughtException.bind(this));
      this.isInitialized = true;
    }
  }

  /**
   * Handle JavaScript errors from ErrorUtils
   */
  private handleJavaScriptError(error: Error, isFatal?: boolean): void {
    try {
      const errorEvent: ErrorEvent = {
        type: 'javascript' as ErrorSource,
        message: error.message || 'Unknown JavaScript error',
        timestamp: Date.now(),
        hasStackTrace: !!error.stack,
        stackTrace: error.stack,
        handling: 'unhandled' as ErrorHandling,
        severity: (isFatal ? 'fatal' : 'non_fatal') as ErrorSeverity,
        errorClass: error.name || error.constructor?.name || 'Error',
        context: {
          'error.is_fatal': String(isFatal || false),
          'error.source': 'error_utils'
        }
      };

      this.onErrorEvent(errorEvent);

      if (this.debugMode) {
        console.log('JavaScriptErrorHandler: Captured JavaScript error:', errorEvent);
      }
    } catch (handlerError) {
      if (this.debugMode) {
        console.error('JavaScriptErrorHandler: Error in error handler:', handlerError);
      }
    }

    // Call original handler if it exists
    if (this.originalHandler) {
      try {
        this.originalHandler(error, isFatal);
      } catch (originalHandlerError) {
        if (this.debugMode) {
          console.error('JavaScriptErrorHandler: Error in original handler:', originalHandlerError);
        }
      }
    }
  }

  /**
   * Handle window error events (browser fallback)
   */
  private handleWindowError(event: ErrorEvent): void {
    try {
      const error = event.error || new Error(event.message);
      
      const errorEvent: ErrorEvent = {
        type: 'javascript' as ErrorSource,
        message: error.message || event.message || 'Unknown window error',
        timestamp: Date.now(),
        hasStackTrace: !!error.stack,
        stackTrace: error.stack,
        handling: 'unhandled' as ErrorHandling,
        severity: 'non_fatal' as ErrorSeverity,
        errorClass: error.name || 'Error',
        context: {
          'error.filename': event.filename,
          'error.lineno': String(event.lineno),
          'error.colno': String(event.colno),
          'error.source': 'window_error'
        }
      };

      this.onErrorEvent(errorEvent);

      if (this.debugMode) {
        console.log('JavaScriptErrorHandler: Captured window error:', errorEvent);
      }
    } catch (handlerError) {
      if (this.debugMode) {
        console.error('JavaScriptErrorHandler: Error in window error handler:', handlerError);
      }
    }
  }

  /**
   * Handle uncaught exceptions (Node.js fallback)
   */
  private handleUncaughtException(error: Error): void {
    try {
      const errorEvent: ErrorEvent = {
        type: 'javascript' as ErrorSource,
        message: error.message || 'Uncaught exception',
        timestamp: Date.now(),
        hasStackTrace: !!error.stack,
        stackTrace: error.stack,
        handling: 'unhandled' as ErrorHandling,
        severity: 'fatal' as ErrorSeverity,
        errorClass: error.name || error.constructor?.name || 'Error',
        context: {
          'error.source': 'uncaught_exception'
        }
      };

      this.onErrorEvent(errorEvent);

      if (this.debugMode) {
        console.log('JavaScriptErrorHandler: Captured uncaught exception:', errorEvent);
      }
    } catch (handlerError) {
      if (this.debugMode) {
        console.error('JavaScriptErrorHandler: Error in uncaught exception handler:', handlerError);
      }
    }
  }

  /**
   * Check if handler is initialized
   */
  isActive(): boolean {
    return this.isInitialized;
  }

  /**
   * Dispose of the error handler
   */
  dispose(): void {
    if (!this.isInitialized) {
      return;
    }

    try {
      if (typeof ErrorUtils !== 'undefined' && this.originalHandler) {
        // Restore original handler
        ErrorUtils.setGlobalHandler(this.originalHandler);
      }

      if (typeof window !== 'undefined') {
        window.removeEventListener('error', this.handleWindowError.bind(this));
      }

      if (typeof process !== 'undefined') {
        process.removeListener('uncaughtException', this.handleUncaughtException.bind(this));
      }

      this.isInitialized = false;
      this.originalHandler = undefined;

      if (this.debugMode) {
        console.log('JavaScriptErrorHandler: Disposed');
      }
    } catch (error) {
      if (this.debugMode) {
        console.error('JavaScriptErrorHandler: Error during disposal:', error);
      }
    }
  }
}
