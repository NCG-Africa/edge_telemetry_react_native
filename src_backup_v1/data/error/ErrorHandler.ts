/**
 * Error Handler for Crash and Error Monitoring
 * 
 * This module provides functionality to capture unhandled errors and crashes
 * for telemetry purposes. It sets up global error listeners to automatically
 * track JavaScript errors and unhandled promise rejections.
 */

import { EdgeTelemetry } from '../../core/EdgeTelemetry';

// Type declarations for browser environment
declare const window: any;
declare const global: any;

// Track if error handling is already set up
let isErrorHandlingEnabled = false;

// Store original error handlers
let originalOnError: any = null;
let originalOnUnhandledRejection: any = null;

/**
 * Starts global error tracking
 */
export function startErrorTracking(): void {
  if (isErrorHandlingEnabled) {
    console.warn('ErrorHandler: Error tracking is already enabled');
    return;
  }

  try {
    // Set up global error handler (browser environment)
    if (typeof window !== 'undefined') {
      // Store original handler
      originalOnError = window.onerror;
      
      // Set up new error handler
      window.addEventListener('error', (event: any) => {
        // Track the error event
        EdgeTelemetry.trackEvent({
          type: 'error.javascript',
          message: event.message,
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          stack: event.error?.stack,
          timestamp: new Date().toISOString(),
          source: 'internal'
        });

        // Call original handler if it exists
        if (originalOnError) {
          originalOnError(event);
        }
      });

      // Set up unhandled promise rejection handler
      originalOnUnhandledRejection = window.onunhandledrejection;
      
      window.addEventListener('unhandledrejection', (event: any) => {
        // Track the unhandled promise rejection
        EdgeTelemetry.trackEvent({
          type: 'error.unhandled_promise',
          reason: event.reason?.toString() || 'Unknown promise rejection',
          stack: event.reason?.stack,
          timestamp: new Date().toISOString(),
          source: 'internal'
        });

        // Call original handler if it exists
        if (originalOnUnhandledRejection) {
          originalOnUnhandledRejection(event);
        }
      });
    }

    isErrorHandlingEnabled = true;
    console.log('ErrorHandler: Global error tracking enabled');
  } catch (error) {
    console.error('ErrorHandler: Failed to start error tracking:', error);
  }
}

/**
 * Stops global error tracking
 */
export function stopErrorTracking(): void {
  if (!isErrorHandlingEnabled) {
    return;
  }

  try {
    if (typeof window !== 'undefined') {
      // Note: We can't easily remove specific listeners without references
      // This is a limitation of the current implementation
      
      // Restore original handlers
      if (originalOnError) {
        window.onerror = originalOnError;
        originalOnError = null;
      }
      
      if (originalOnUnhandledRejection) {
        window.onunhandledrejection = originalOnUnhandledRejection;
        originalOnUnhandledRejection = null;
      }
    }

    isErrorHandlingEnabled = false;
    console.log('ErrorHandler: Global error tracking stopped');
  } catch (error) {
    console.error('ErrorHandler: Failed to stop error tracking:', error);
  }
}

/**
 * Manually tracks an error (for custom error handling)
 * @param error Error object or message
 * @param context Optional context information
 */
export function trackError(error: Error | string, context?: Record<string, any>): void {
  const errorMessage = typeof error === 'string' ? error : error.message;
  const errorStack = typeof error === 'object' && error.stack ? error.stack : undefined;

  EdgeTelemetry.trackEvent({
    type: 'error.manual',
    message: errorMessage,
    stack: errorStack,
    context,
    timestamp: new Date().toISOString(),
    source: 'internal'
  });
}

/**
 * Gets the current error tracking state
 * @returns True if error tracking is enabled, false otherwise
 */
export function getErrorTrackingState(): boolean {
  return isErrorHandlingEnabled;
}
