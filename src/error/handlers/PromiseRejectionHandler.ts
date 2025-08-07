import type { ErrorEvent, ErrorSource, ErrorHandling, ErrorSeverity } from '../types/ErrorTypes';

/**
 * PromiseRejectionHandler - Captures unhandled promise rejections
 * Provides identical functionality to Flutter's unhandled promise rejection handling
 */
export class PromiseRejectionHandler {
  private onErrorEvent: (event: ErrorEvent) => void;
  private isInitialized = false;
  private debugMode = false;

  constructor(onErrorEvent: (event: ErrorEvent) => void, debugMode = false) {
    this.onErrorEvent = onErrorEvent;
    this.debugMode = debugMode;
  }

  /**
   * Initialize promise rejection handling
   */
  initialize(): void {
    if (this.isInitialized) {
      if (this.debugMode) {
        console.warn('PromiseRejectionHandler: Already initialized');
      }
      return;
    }

    // Check for different environments and add appropriate listeners
    if (typeof window !== 'undefined') {
      // Browser environment
      window.addEventListener('unhandledrejection', this.handleUnhandledRejection.bind(this));
      this.isInitialized = true;
      
      if (this.debugMode) {
        console.log('PromiseRejectionHandler: Initialized for browser environment');
      }
    } else if (typeof global !== 'undefined') {
      // React Native / Node.js environment
      if (typeof global.addEventListener === 'function') {
        // React Native with global addEventListener
        global.addEventListener('unhandledrejection', this.handleUnhandledRejection.bind(this));
        this.isInitialized = true;
        
        if (this.debugMode) {
          console.log('PromiseRejectionHandler: Initialized for React Native environment');
        }
      } else if (typeof process !== 'undefined' && process.on) {
        // Node.js environment
        process.on('unhandledRejection', this.handleNodeUnhandledRejection.bind(this));
        this.isInitialized = true;
        
        if (this.debugMode) {
          console.log('PromiseRejectionHandler: Initialized for Node.js environment');
        }
      }
    }

    if (!this.isInitialized && this.debugMode) {
      console.warn('PromiseRejectionHandler: Could not initialize - no suitable environment detected');
    }
  }

  /**
   * Handle unhandled promise rejections (browser/React Native)
   */
  private handleUnhandledRejection(event: PromiseRejectionEvent): void {
    try {
      const reason = event.reason;
      let error: Error;
      let message: string;
      let stackTrace: string | undefined;

      // Handle different types of rejection reasons
      if (reason instanceof Error) {
        error = reason;
        message = error.message || 'Unhandled promise rejection';
        stackTrace = error.stack;
      } else if (typeof reason === 'string') {
        message = reason;
        error = new Error(reason);
        stackTrace = error.stack;
      } else if (reason && typeof reason === 'object') {
        message = reason.message || reason.toString() || 'Unhandled promise rejection';
        error = new Error(message);
        stackTrace = reason.stack || error.stack;
      } else {
        message = String(reason) || 'Unhandled promise rejection';
        error = new Error(message);
        stackTrace = error.stack;
      }

      const errorEvent: ErrorEvent = {
        type: 'promise_rejection' as ErrorSource,
        message: message,
        timestamp: Date.now(),
        hasStackTrace: !!stackTrace,
        stackTrace: stackTrace,
        handling: 'unhandled' as ErrorHandling,
        severity: 'non_fatal' as ErrorSeverity,
        errorClass: error.name || error.constructor?.name || 'PromiseRejection',
        context: {
          'error.source': 'unhandled_rejection',
          'error.reason_type': typeof reason
        }
      };

      this.onErrorEvent(errorEvent);

      if (this.debugMode) {
        console.log('PromiseRejectionHandler: Captured unhandled promise rejection:', errorEvent);
      }
    } catch (handlerError) {
      if (this.debugMode) {
        console.error('PromiseRejectionHandler: Error in rejection handler:', handlerError);
      }
    }
  }

  /**
   * Handle unhandled promise rejections (Node.js)
   */
  private handleNodeUnhandledRejection(reason: any, promise: Promise<any>): void {
    try {
      let error: Error;
      let message: string;
      let stackTrace: string | undefined;

      // Handle different types of rejection reasons
      if (reason instanceof Error) {
        error = reason;
        message = error.message || 'Unhandled promise rejection';
        stackTrace = error.stack;
      } else if (typeof reason === 'string') {
        message = reason;
        error = new Error(reason);
        stackTrace = error.stack;
      } else if (reason && typeof reason === 'object') {
        message = reason.message || reason.toString() || 'Unhandled promise rejection';
        error = new Error(message);
        stackTrace = reason.stack || error.stack;
      } else {
        message = String(reason) || 'Unhandled promise rejection';
        error = new Error(message);
        stackTrace = error.stack;
      }

      const errorEvent: ErrorEvent = {
        type: 'promise_rejection' as ErrorSource,
        message: message,
        timestamp: Date.now(),
        hasStackTrace: !!stackTrace,
        stackTrace: stackTrace,
        handling: 'unhandled' as ErrorHandling,
        severity: 'non_fatal' as ErrorSeverity,
        errorClass: error.name || error.constructor?.name || 'PromiseRejection',
        context: {
          'error.source': 'node_unhandled_rejection',
          'error.reason_type': typeof reason,
          'error.promise_string': promise.toString()
        }
      };

      this.onErrorEvent(errorEvent);

      if (this.debugMode) {
        console.log('PromiseRejectionHandler: Captured Node.js unhandled promise rejection:', errorEvent);
      }
    } catch (handlerError) {
      if (this.debugMode) {
        console.error('PromiseRejectionHandler: Error in Node.js rejection handler:', handlerError);
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
   * Dispose of the promise rejection handler
   */
  dispose(): void {
    if (!this.isInitialized) {
      return;
    }

    try {
      if (typeof window !== 'undefined') {
        window.removeEventListener('unhandledrejection', this.handleUnhandledRejection.bind(this));
      }

      if (typeof global !== 'undefined' && typeof global.removeEventListener === 'function') {
        global.removeEventListener('unhandledrejection', this.handleUnhandledRejection.bind(this));
      }

      if (typeof process !== 'undefined' && process.removeListener) {
        process.removeListener('unhandledRejection', this.handleNodeUnhandledRejection.bind(this));
      }

      this.isInitialized = false;

      if (this.debugMode) {
        console.log('PromiseRejectionHandler: Disposed');
      }
    } catch (error) {
      if (this.debugMode) {
        console.error('PromiseRejectionHandler: Error during disposal:', error);
      }
    }
  }
}
