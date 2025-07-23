import { initialize, logMessage } from '@embrace-io/react-native';
import type { TelemetryClient } from '../domain/TelemetryClient';

/**
 * Implementation of TelemetryClient using the Embrace React Native SDK
 */
export class EmbraceClient implements TelemetryClient {
  private isInitialized = false;
  private debugMode = false;

  /** 
   * Initializes the Embrace telemetry system and starts a session.
   * Crash and ANR monitoring are automatically enabled by default.
   */
  async start(debugMode = false): Promise<void> {
    // Store debug mode for use in other methods
    this.debugMode = debugMode;

    // Prevent re-initialization if already started
    if (this.isInitialized) {
      if (this.debugMode) {
        console.log('EmbraceClient: Already initialized, skipping...');
      }
      return;
    }

    try {
      if (this.debugMode) {
        console.log('EmbraceClient: Initializing Embrace SDK...');
      }

      // Crash and ANR monitoring are enabled by default via Embrace.initialize()
      // This is a deliberate choice to ensure these critical features are always on
      const isStarted = await initialize({
        sdkConfig: {
          // Configuration will be provided by the main EdgeTelemetry.init() method
          // This is a minimal setup for the client
        },
      });
      
      this.isInitialized = isStarted;

      if (this.debugMode) {
        if (isStarted) {
          console.log('EmbraceClient: Embrace SDK initialized successfully');
          console.log('EmbraceClient: Crash and ANR monitoring are enabled by default');
        } else {
          console.warn('EmbraceClient: Embrace SDK initialization returned false');
        }
      }

      // Throw error if initialization failed
      if (!isStarted) {
        throw new Error('Embrace SDK initialization failed');
      }
    } catch (error) {
      // Handle errors gracefully with try/catch
      const errorMessage = `Failed to initialize Embrace SDK: ${error instanceof Error ? error.message : String(error)}`;
      
      if (this.debugMode) {
        console.error('EmbraceClient:', errorMessage);
      } else {
        console.warn('EmbraceClient:', errorMessage);
      }
      
      this.isInitialized = false;
      
      // Re-throw to allow EdgeTelemetry to handle the error
      throw new Error(errorMessage);
    }
  }

  /** Tracks a custom telemetry event using Embrace's logMessage method */
  trackEvent(name: string, attributes?: Record<string, any>): void {
    if (!this.isInitialized) {
      console.warn('Embrace SDK not initialized. Cannot track event:', name);
      return;
    }

    try {
      const message = attributes 
        ? `${name}: ${JSON.stringify(attributes)}`
        : name;
      logMessage(message, 'info', attributes);
    } catch (error) {
      console.warn('Failed to track event:', error);
    }
  }

  /** Records an exception with optional context using Embrace's logMessage method for errors */
  recordException(error: Error, context?: Record<string, any>): void {
    if (!this.isInitialized) {
      console.warn('Embrace SDK not initialized. Cannot record exception:', error.message);
      return;
    }

    try {
      const errorMessage = `Exception: ${error.message}`;
      const errorContext = {
        stack: error.stack || 'No stack trace available',
        name: error.name,
        ...context,
      };
      logMessage(errorMessage, 'error', errorContext);
    } catch (logError) {
      console.warn('Failed to record exception:', logError);
    }
  }

  /** Cleanly shuts down the telemetry system */
  shutdown(): void {
    // Embrace SDK doesn't provide explicit shutdown method
    // The SDK handles session management automatically
    this.isInitialized = false;
  }
}