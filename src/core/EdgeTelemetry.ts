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
    // Prevent double initialization and config overwrite
    if (this.isInitialized) {
      if (config.debug) {
        console.log('EdgeTelemetry: SDK already initialized, skipping...');
        console.log('EdgeTelemetry: Current config will not be overwritten');
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
      // Pass debug mode to enable proper logging
      await this.telemetryClient.start(config.debug);

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
   * @returns The current configuration
   * @throws Error if SDK is not initialized
   */
  getConfig(): EdgeTelemetryConfig {
    if (!this.config || !this.isInitialized) {
      throw new Error('EdgeTelemetry: SDK not initialized. Call EdgeTelemetry.init() first.');
    }
    return this.config;
  }

  /**
   * Gets the current configuration safely (without throwing)
   * @returns The current configuration or null if not initialized
   */
  getConfigSafe(): EdgeTelemetryConfig | null {
    return this.config;
  }

  /**
   * Gets the debug mode setting
   * @returns True if debug mode is enabled, false otherwise
   * @throws Error if SDK is not initialized
   */
  getDebugMode(): boolean {
    if (!this.config || !this.isInitialized) {
      throw new Error('EdgeTelemetry: SDK not initialized. Call EdgeTelemetry.init() first.');
    }
    return this.config.debug || false;
  }

  /**
   * Gets the application name from config
   * @returns The application name
   * @throws Error if SDK is not initialized
   */
  getAppName(): string {
    if (!this.config || !this.isInitialized) {
      throw new Error('EdgeTelemetry: SDK not initialized. Call EdgeTelemetry.init() first.');
    }
    return this.config.appName;
  }

  /**
   * Gets the export URL from config
   * @returns The export URL for telemetry data
   * @throws Error if SDK is not initialized
   */
  getExportUrl(): string {
    if (!this.config || !this.isInitialized) {
      throw new Error('EdgeTelemetry: SDK not initialized. Call EdgeTelemetry.init() first.');
    }
    return this.config.exportUrl;
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