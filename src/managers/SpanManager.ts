import type { Span } from '@opentelemetry/api';
import { OpenTelemetryManager } from '../telemetry/OpenTelemetryManager';
import { UserIdManager } from './UserIdManager';

/**
 * SpanManager - Manages OpenTelemetry spans and user context
 * Provides high-level span management functionality
 */
export class SpanManager {
  private openTelemetryManager: OpenTelemetryManager;
  private userIdManager: UserIdManager;
  private initialized = false;

  constructor() {
    this.openTelemetryManager = new OpenTelemetryManager();
    this.userIdManager = UserIdManager.getInstance();
  }

  /**
   * Initialize the span manager
   */
  async initialize(): Promise<void> {
    this.initialized = true;
  }

  /**
   * Set user information for telemetry context
   * Must match Flutter SDK user context handling
   */
  async setUser(userId: string, email?: string, name?: string): Promise<void> {
    if (!this.initialized) {
      console.warn('EdgeTelemetry: SpanManager not initialized');
      return;
    }

    try {
      // Set user ID in user manager
      await this.userIdManager.setCustomUserId(userId);

      // Add user attributes to active span if available
      const userAttributes: Record<string, string> = {
        'user.id': userId,
      };

      if (email) {
        userAttributes['user.email'] = email;
      }

      if (name) {
        userAttributes['user.name'] = name;
      }

      this.openTelemetryManager.addAttributesToActiveSpan(userAttributes);

    } catch (error) {
      console.error('EdgeTelemetry: Failed to set user context:', error);
    }
  }

  /**
   * Create a new span with attributes
   */
  createSpan(name: string, attributes?: Record<string, string>): Span | null {
    if (!this.initialized) {
      console.warn('EdgeTelemetry: SpanManager not initialized');
      return null;
    }

    return this.openTelemetryManager.createSpan(name, attributes);
  }

  /**
   * Execute a function within a span context
   * Automatically handles span lifecycle
   */
  async withSpan<T>(spanName: string, operation: () => Promise<T>, attributes?: Record<string, string>): Promise<T> {
    if (!this.initialized) {
      console.warn('EdgeTelemetry: SpanManager not initialized, executing without span');
      return await operation();
    }

    return await this.openTelemetryManager.withSpan(spanName, operation, attributes);
  }

  /**
   * Get the current active span
   */
  getActiveSpan(): Span | undefined {
    if (!this.initialized) {
      return undefined;
    }

    return this.openTelemetryManager.getActiveSpan();
  }

  /**
   * Add attributes to the current active span
   */
  addAttributesToActiveSpan(attributes: Record<string, string>): void {
    if (!this.initialized) {
      return;
    }

    this.openTelemetryManager.addAttributesToActiveSpan(attributes);
  }

  /**
   * End a span with status
   */
  endSpan(span: Span, success?: boolean, errorMessage?: string): void {
    if (!this.initialized) {
      return;
    }

    this.openTelemetryManager.endSpan(span, success, errorMessage);
  }

  /**
   * Check if span manager is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Shutdown span manager
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    await this.openTelemetryManager.shutdown();
    this.initialized = false;
  }
}
