import type { EdgeTelemetryConfig } from './EdgeTelemetryConfig';
import type { TelemetryClient } from '../domain/TelemetryClient';
import { EmbraceClient } from '../data/EmbraceClient';
import { JsonExporter } from '../data/exporter/JsonExporter';
import { startErrorTracking, stopErrorTracking } from '../data/error/ErrorHandler';

/**
 * EdgeTelemetry coordinator class that serves as the public API
 * for the telemetry SDK. Handles initialization and orchestration
 * of the underlying telemetry client.
 */
class EdgeTelemetryCoordinator {
  private config: EdgeTelemetryConfig | null = null;
  private telemetryClient: TelemetryClient | null = null;
  private exporter: JsonExporter | null = null;
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

      // Initialize JsonExporter for telemetry data export
      this.exporter = new JsonExporter(
        config.exportUrl,
        config.debug || false,
        config.batchSize || 30 // use configured batch size or default to 30
      );

      // Call the start method (which uses initialize() internally)
      // Pass debug mode to enable proper logging
      await this.telemetryClient.start(config.debug);

      // Start internal telemetry tracking
      startErrorTracking();

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
      this.exporter = null;
      this.isInitialized = false;
      
      // Stop error tracking if it was started
      stopErrorTracking();
      
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

  /**
   * Tracks a custom telemetry event with optional attributes
   * @param eventName Name of the event to track
   * @param attributes Optional attributes/properties for the event
   */
  trackEvent(eventName: string, attributes?: Record<string, any>): void;
  
  /**
   * Tracks a telemetry event using object format (for internal events)
   * @param event Event object with type, timestamp, and other properties
   */
  trackEvent(event: Record<string, any>): void;
  
  trackEvent(eventNameOrEvent: string | Record<string, any>, attributes?: Record<string, any>): void {
    // Warn if SDK is not initialized
    if (!this.isInitialized || !this.exporter) {
      const eventIdentifier = typeof eventNameOrEvent === 'string' ? eventNameOrEvent : eventNameOrEvent.type || 'unknown';
      console.warn('EdgeTelemetry: SDK not initialized. Call EdgeTelemetry.init() first. Event will be ignored:', eventIdentifier);
      return;
    }

    try {
      let telemetryEvent: Record<string, any>;
      let eventName: string;
      let isInternalEvent = false;

      // Handle both string-based and object-based event formats
      if (typeof eventNameOrEvent === 'string') {
        // Traditional string-based event format
        eventName = eventNameOrEvent;
        
        // Validate event name
        if (!eventName || typeof eventName !== 'string') {
          console.warn('EdgeTelemetry: Event name must be a non-empty string. Event ignored.');
          return;
        }

        // Create the telemetry event with enrichment
        telemetryEvent = {
          eventName: eventName.trim(),
          timestamp: new Date().toISOString(),
          appName: this.config?.appName || 'unknown',
          attributes: this.sanitizeAttributes(attributes),
        };
      } else {
        // Object-based event format (for internal events)
        const eventObj = eventNameOrEvent;
        eventName = eventObj.type || 'unknown';
        isInternalEvent = eventObj.source === 'internal';
        
        // Create telemetry event from object
        telemetryEvent = {
          ...eventObj,
          timestamp: eventObj.timestamp || new Date().toISOString(),
          appName: this.config?.appName || 'unknown',
        };
        
        // Ensure attributes are sanitized if present
        if (telemetryEvent.attributes) {
          telemetryEvent.attributes = this.sanitizeAttributes(telemetryEvent.attributes);
        }
      }

      // Debug logging if enabled
      if (this.config?.debug) {
        const logPrefix = isInternalEvent ? '[EdgeTelemetry] Internal event captured' : 'EdgeTelemetry: Tracking event';
        const logSuffix = isInternalEvent ? '→ added to batch' : '';
        
        console.log(`${logPrefix}: ${eventName} ${logSuffix}`, {
          eventName,
          timestamp: telemetryEvent.timestamp,
          isInternal: isInternalEvent,
          attributeCount: telemetryEvent.attributes ? Object.keys(telemetryEvent.attributes).length : 0,
        });
      }

      // Queue the event for export via JsonExporter
      this.exporter.export(telemetryEvent);

      // Also send to the underlying telemetry client (Embrace) for non-internal events
      if (this.telemetryClient && !isInternalEvent && typeof eventNameOrEvent === 'string') {
        this.telemetryClient.trackEvent(eventName, attributes);
      }
    } catch (error) {
      const eventIdentifier = typeof eventNameOrEvent === 'string' ? eventNameOrEvent : eventNameOrEvent.type || 'unknown';
      console.error('EdgeTelemetry: Failed to track event:', eventIdentifier, error);
    }
  }

  /**
   * Sanitizes attributes to ensure JSON serializability
   * @param attributes Raw attributes object
   * @returns Sanitized attributes safe for JSON serialization
   */
  private sanitizeAttributes(attributes?: Record<string, any>): Record<string, any> | undefined {
    if (!attributes || typeof attributes !== 'object') {
      return undefined;
    }

    try {
      const sanitized: Record<string, any> = {};

      for (const [key, value] of Object.entries(attributes)) {
        // Skip functions, symbols, and undefined values
        if (typeof value === 'function' || typeof value === 'symbol' || value === undefined) {
          if (this.config?.debug) {
            console.warn(`EdgeTelemetry: Skipping non-serializable attribute '${key}' of type '${typeof value}'`);
          }
          continue;
        }

        // Handle null, primitives, and objects
        if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          sanitized[key] = value;
        } else if (Array.isArray(value)) {
          // Recursively sanitize arrays
          sanitized[key] = value.map(item => {
            if (typeof item === 'object' && item !== null) {
              return this.sanitizeAttributes(item as Record<string, any>) || {};
            }
            return item;
          });
        } else if (typeof value === 'object') {
          // Recursively sanitize nested objects
          sanitized[key] = this.sanitizeAttributes(value as Record<string, any>) || {};
        } else {
          // Convert other types to string representation
          sanitized[key] = String(value);
        }
      }

      // Test JSON serializability
      JSON.stringify(sanitized);
      return sanitized;
    } catch (error) {
      if (this.config?.debug) {
        console.warn('EdgeTelemetry: Failed to sanitize attributes, using empty object:', error);
      }
      return {};
    }
  }
}

// Export a singleton instance
export const EdgeTelemetry = new EdgeTelemetryCoordinator();