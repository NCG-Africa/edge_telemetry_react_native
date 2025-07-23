import type { EdgeTelemetryConfig } from './EdgeTelemetryConfig';
import type { TelemetryClient } from '../domain/TelemetryClient';
import { EmbraceClient } from '../data/EmbraceClient';

/**
 * EdgeTelemetry coordinator class that serves as the public API
 * for the telemetry SDK. Handles initialization and orchestration
 * of the underlying telemetry client.
 */
class EdgeTelemetryCoordinator {
  private config: EdgeTelemetryConfig | null = null;
  private telemetryClient: TelemetryClient | null = null;
  private isInitialized = false;

  /**
   * Initializes the EdgeTelemetry SDK with the provided configuration
   * @param config Configuration object containing appName, exportUrl, and optional debug flag
   */
  async init(config: EdgeTelemetryConfig): Promise<void> {
    // Prevent double initialization
    if (this.isInitialized) {
      if (config.debug) {
        console.log('EdgeTelemetry: SDK already initialized, skipping...');
      }
      return;
    }

    try {
      // Validate the config
      this.validateConfig(config);

      // Store the config internally
      this.config = config;

      // Initialize an instance of EmbraceClient
      this.telemetryClient = new EmbraceClient();

      // Call the start method (which uses initialize() internally)
      await this.telemetryClient.start();

      // Mark as initialized
      this.isInitialized = true;

      // Log initialization success if debug is enabled
      if (config.debug) {
        console.log('EdgeTelemetry: SDK initialized successfully', {
          appName: config.appName,
          exportUrl: config.exportUrl,
        });
      }
    } catch (error) {
      // Handle errors gracefully
      console.error('EdgeTelemetry: Failed to initialize SDK:', error);
      
      // Reset state on failure
      this.config = null;
      this.telemetryClient = null;
      this.isInitialized = false;
      
      throw error;
    }
  }

  /**
   * Validates the configuration object
   * @param config Configuration to validate
   */
  private validateConfig(config: EdgeTelemetryConfig): void {
    if (!config) {
      throw new Error('EdgeTelemetry: Configuration is required');
    }

    if (!config.appName || typeof config.appName !== 'string') {
      throw new Error('EdgeTelemetry: appName is required and must be a string');
    }

    if (!config.exportUrl || typeof config.exportUrl !== 'string') {
      throw new Error('EdgeTelemetry: exportUrl is required and must be a string');
    }

    // Validate exportUrl format
    try {
      new URL(config.exportUrl);
    } catch {
      throw new Error('EdgeTelemetry: exportUrl must be a valid URL');
    }
  }

  /**
   * Gets the current configuration
   * @returns The current configuration or null if not initialized
   */
  getConfig(): EdgeTelemetryConfig | null {
    return this.config;
  }

  /**
   * Gets the telemetry client instance
   * @returns The telemetry client or null if not initialized
   */
  getTelemetryClient(): TelemetryClient | null {
    return this.telemetryClient;
  }

  /**
   * Checks if the SDK is initialized
   * @returns True if initialized, false otherwise
   */
  getIsInitialized(): boolean {
    return this.isInitialized;
  }
}

// Export a singleton instance
export const EdgeTelemetry = new EdgeTelemetryCoordinator();