import { trace, SpanStatusCode, SpanKind } from '@opentelemetry/api';
import type { Span } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import type { TelemetryConfig } from '../core/config/TelemetryConfig';
import type { TelemetryEvent } from '../core/models/TelemetryEvent';

/**
 * OpenTelemetryManager - Manages OpenTelemetry integration
 * Must mirror Flutter's OpenTelemetry configuration exactly
 */
export class OpenTelemetryManager {
  private sdk?: NodeSDK;
  private tracer?: any;
  private initialized = false;
  private config?: TelemetryConfig;

  /**
   * Initialize OpenTelemetry SDK with configuration matching Flutter
   */
  async initialize(config: TelemetryConfig): Promise<void> {
    if (this.initialized) {
      console.warn('EdgeTelemetry: OpenTelemetry already initialized');
      return;
    }

    try {
      this.config = config;

      // Configure OpenTelemetry SDK
      this.sdk = new NodeSDK({
        serviceName: config.serviceName,
        instrumentations: [getNodeAutoInstrumentations({
          // Disable instrumentations that might not work well in React Native
          '@opentelemetry/instrumentation-fs': {
            enabled: false,
          },
          '@opentelemetry/instrumentation-http': {
            enabled: config.enableHttpMonitoring,
          },
          '@opentelemetry/instrumentation-net': {
            enabled: config.enableNetworkMonitoring,
          },
        })],
      });

      // Start the SDK
      this.sdk.start();

      // Get tracer instance
      this.tracer = trace.getTracer(
        'edge-telemetry-react-native',
        '2.0.0'
      );

      this.initialized = true;

      if (config.debugMode) {
        console.log('EdgeTelemetry: OpenTelemetry initialized successfully');
      }

    } catch (error) {
      console.error('EdgeTelemetry: Failed to initialize OpenTelemetry:', error);
      throw error;
    }
  }

  /**
   * Create a new span with attributes
   * Mirrors Flutter's span creation
   */
  createSpan(name: string, attributes?: Record<string, string>): Span | null {
    if (!this.initialized || !this.tracer) {
      console.warn('EdgeTelemetry: OpenTelemetry not initialized');
      return null;
    }

    try {
      const span = this.tracer.startSpan(name, {
        kind: SpanKind.INTERNAL,
        attributes: attributes || {},
      });

      if (this.config?.debugMode) {
        console.log('EdgeTelemetry: Span created:', name, attributes);
      }

      return span;
    } catch (error) {
      console.error('EdgeTelemetry: Failed to create span:', error);
      return null;
    }
  }

  /**
   * End a span with optional success/error status
   * Mirrors Flutter's span ending logic
   */
  endSpan(span: Span, success?: boolean, errorMessage?: string): void {
    if (!span) {
      return;
    }

    try {
      if (success === false && errorMessage) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: errorMessage,
        });
        span.setAttribute('error', true);
        span.setAttribute('error.message', errorMessage);
      } else if (success !== false) {
        span.setStatus({ code: SpanStatusCode.OK });
      }

      span.end();

      if (this.config?.debugMode) {
        console.log('EdgeTelemetry: Span ended:', success, errorMessage);
      }
    } catch (error) {
      console.error('EdgeTelemetry: Failed to end span:', error);
    }
  }

  /**
   * Convert telemetry event to OpenTelemetry span
   * Ensures compatibility with Flutter's telemetry format
   */
  createSpanFromEvent(event: TelemetryEvent): Span | null {
    const span = this.createSpan(event.eventName, event.attributes);
    
    if (span) {
      // Add standard event attributes
      span.setAttribute('event.id', event.id);
      span.setAttribute('event.session_id', event.sessionId);
      span.setAttribute('event.timestamp', event.timestamp.toISOString());
      
      if (event.userId) {
        span.setAttribute('event.user_id', event.userId);
      }

      // End span immediately for events (they're point-in-time)
      this.endSpan(span, true);
    }

    return span;
  }

  /**
   * Send telemetry events as OpenTelemetry spans
   */
  sendEvents(events: TelemetryEvent[]): void {
    if (!this.initialized) {
      console.warn('EdgeTelemetry: OpenTelemetry not initialized, cannot send events');
      return;
    }

    try {
      for (const event of events) {
        this.createSpanFromEvent(event);
      }

      if (this.config?.debugMode) {
        console.log(`EdgeTelemetry: Sent ${events.length} events as OpenTelemetry spans`);
      }
    } catch (error) {
      console.error('EdgeTelemetry: Failed to send events via OpenTelemetry:', error);
    }
  }

  /**
   * Execute a function within a span context
   * Useful for automatic instrumentation
   */
  async withSpan<T>(spanName: string, operation: () => Promise<T>, attributes?: Record<string, string>): Promise<T> {
    const span = this.createSpan(spanName, attributes);
    
    if (!span) {
      // Fallback: execute without span if creation failed
      return await operation();
    }

    try {
      const result = await operation();
      this.endSpan(span, true);
      return result;
    } catch (error) {
      this.endSpan(span, false, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Get the current active span
   */
  getActiveSpan(): Span | undefined {
    if (!this.initialized) {
      return undefined;
    }

    return trace.getActiveSpan();
  }

  /**
   * Add attributes to the current active span
   */
  addAttributesToActiveSpan(attributes: Record<string, string>): void {
    const activeSpan = this.getActiveSpan();
    if (activeSpan) {
      for (const [key, value] of Object.entries(attributes)) {
        activeSpan.setAttribute(key, value);
      }
    }
  }

  /**
   * Shutdown OpenTelemetry SDK
   */
  async shutdown(): Promise<void> {
    if (!this.initialized || !this.sdk) {
      return;
    }

    try {
      await this.sdk.shutdown();
      this.initialized = false;
      this.tracer = undefined;
      this.sdk = undefined;

      if (this.config?.debugMode) {
        console.log('EdgeTelemetry: OpenTelemetry shutdown complete');
      }
    } catch (error) {
      console.error('EdgeTelemetry: Error during OpenTelemetry shutdown:', error);
    }
  }

  /**
   * Check if OpenTelemetry is initialized and ready
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get OpenTelemetry configuration
   */
  getConfig(): TelemetryConfig | undefined {
    return this.config;
  }
}
