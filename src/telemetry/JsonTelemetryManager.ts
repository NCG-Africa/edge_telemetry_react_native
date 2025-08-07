import type { TelemetryConfig } from '../core/config/TelemetryConfig';
import type { TelemetryEvent } from '../core/models/TelemetryEvent';

/**
 * JsonTelemetryManager - Alternative to OpenTelemetry for JSON-based telemetry
 * Must produce identical JSON format to Flutter SDK for backend compatibility
 */
export class JsonTelemetryManager {
  private config?: TelemetryConfig;
  private initialized = false;

  /**
   * Initialize JSON telemetry manager
   */
  async initialize(config: TelemetryConfig): Promise<void> {
    this.config = config;
    this.initialized = true;

    if (config.debugMode) {
      console.log('EdgeTelemetry: JSON telemetry manager initialized');
    }
  }

  /**
   * Send telemetry events as JSON to the configured endpoint
   * Must match Flutter SDK JSON format exactly
   */
  async sendEvents(events: TelemetryEvent[]): Promise<void> {
    if (!this.initialized || !this.config) {
      console.warn('EdgeTelemetry: JSON telemetry manager not initialized');
      return;
    }

    if (events.length === 0) {
      return;
    }

    try {
      // Convert events to JSON format matching Flutter SDK
      const jsonPayload = this.createJsonPayload(events);

      // Send to endpoint
      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'edge-telemetry-react-native/2.0.0',
        },
        body: JSON.stringify(jsonPayload),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (this.config.debugMode) {
        console.log(`EdgeTelemetry: Successfully sent ${events.length} events as JSON`);
      }

    } catch (error) {
      console.error('EdgeTelemetry: Failed to send JSON telemetry:', error);
      
      // Store failed events for retry (optional enhancement)
      if (this.config.debugMode) {
        console.log('EdgeTelemetry: Failed events:', events);
      }
    }
  }

  /**
   * Create JSON payload matching Flutter SDK format exactly
   */
  private createJsonPayload(events: TelemetryEvent[]): any {
    const payload: any = {
      service_name: this.config?.serviceName,
      timestamp: new Date().toISOString(),
      sdk_version: '2.0.0',
      sdk_name: 'edge-telemetry-react-native',
      events: events.map(event => this.convertEventToJson(event)),
      batch_info: {
        batch_size: events.length,
        batch_timestamp: new Date().toISOString(),
      }
    };

    // Add global attributes if configured
    if (this.config?.globalAttributes && Object.keys(this.config.globalAttributes).length > 0) {
      payload.global_attributes = this.config.globalAttributes;
    }

    return payload;
  }

  /**
   * Convert TelemetryEvent to JSON format matching Flutter
   */
  private convertEventToJson(event: TelemetryEvent): any {
    return {
      id: event.id,
      session_id: event.sessionId,
      event_name: event.eventName,
      timestamp: event.timestamp.toISOString(),
      attributes: event.attributes,
      user_id: event.userId || null,
    };
  }

  /**
   * Send a single event immediately (for critical events)
   */
  async sendEventImmediately(event: TelemetryEvent): Promise<void> {
    await this.sendEvents([event]);
  }

  /**
   * Test connection to the telemetry endpoint
   */
  async testConnection(): Promise<boolean> {
    if (!this.initialized || !this.config) {
      return false;
    }

    try {
      const testPayload = {
        service_name: this.config.serviceName,
        timestamp: new Date().toISOString(),
        test: true,
        events: []
      };

      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'edge-telemetry-react-native/2.0.0',
        },
        body: JSON.stringify(testPayload),
      });

      const isConnected = response.ok;

      if (this.config.debugMode) {
        console.log('EdgeTelemetry: Connection test result:', isConnected);
      }

      return isConnected;
    } catch (error) {
      if (this.config?.debugMode) {
        console.log('EdgeTelemetry: Connection test failed:', error);
      }
      return false;
    }
  }

  /**
   * Get telemetry manager status
   */
  getStatus(): { initialized: boolean; endpoint?: string; serviceName?: string } {
    return {
      initialized: this.initialized,
      endpoint: this.config?.endpoint,
      serviceName: this.config?.serviceName,
    };
  }

  /**
   * Shutdown JSON telemetry manager
   */
  async shutdown(): Promise<void> {
    const wasDebugMode = this.config?.debugMode;
    this.initialized = false;
    this.config = undefined;

    if (wasDebugMode) {
      console.log('EdgeTelemetry: JSON telemetry manager shutdown');
    }
  }
}
