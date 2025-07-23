import { initialize, logMessage } from '@embrace-io/react-native';
import type { TelemetryClient } from '../domain/TelemetryClient';

/**
 * Implementation of TelemetryClient using the Embrace React Native SDK
 */
export class EmbraceClient implements TelemetryClient {
  private isInitialized = false;

  /** Initializes the Embrace telemetry system and starts a session */
  async start(): Promise<void> {
    try {
      const isStarted = await initialize({
        sdkConfig: {
          // Configuration will be provided by the main EdgeTelemetry.init() method
          // This is a minimal setup for the client
        },
      });
      this.isInitialized = isStarted;
    } catch (error) {
      console.warn('Failed to initialize Embrace SDK:', error);
      this.isInitialized = false;
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