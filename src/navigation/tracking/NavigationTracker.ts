import type { NavigationEvent } from '../types/NavigationTypes';
import type { TelemetryEvent } from '../../core/models/TelemetryEvent';
import { ScreenDurationTracker } from './ScreenDurationTracker';

/**
 * NavigationTracker - Core tracking logic for navigation events
 * Processes navigation events and formats them for telemetry matching Flutter exactly
 */
export class NavigationTracker {
  private screenDurationTracker: ScreenDurationTracker;
  private onTelemetryEvent: (event: TelemetryEvent) => void;
  private debugMode = false;
  private ignoredRoutes: Set<string> = new Set();

  constructor(
    onTelemetryEvent: (event: TelemetryEvent) => void,
    enableScreenDuration = true,
    debugMode = false
  ) {
    this.onTelemetryEvent = onTelemetryEvent;
    this.debugMode = debugMode;
    this.screenDurationTracker = new ScreenDurationTracker(
      this.handleScreenDurationEvent.bind(this),
      enableScreenDuration,
      debugMode
    );
  }

  /**
   * Track a navigation event
   */
  trackNavigationEvent(navigationEvent: NavigationEvent): void {
    // Check if route should be ignored
    if (this.ignoredRoutes.has(navigationEvent.to)) {
      if (this.debugMode) {
        console.log('NavigationTracker: Ignoring navigation to:', navigationEvent.to);
      }
      return;
    }

    // Track screen duration for previous screen
    if (navigationEvent.from) {
      this.screenDurationTracker.endScreen(navigationEvent.from, navigationEvent.method);
    }

    // Start tracking duration for new screen
    this.screenDurationTracker.startScreen(navigationEvent.to);

    // Create telemetry event matching Flutter format
    const telemetryEvent = this.createNavigationTelemetryEvent(navigationEvent);
    
    // Send telemetry event
    this.onTelemetryEvent(telemetryEvent);

    if (this.debugMode) {
      console.log('NavigationTracker: Tracked navigation event:', telemetryEvent);
    }
  }

  /**
   * Create navigation telemetry event matching Flutter format exactly
   */
  private createNavigationTelemetryEvent(navigationEvent: NavigationEvent): TelemetryEvent {
    const attributes: Record<string, string> = {
      'navigation.to': navigationEvent.to,
      'navigation.method': navigationEvent.method,
      'navigation.type': navigationEvent.type,
      'navigation.timestamp': navigationEvent.timestamp.toString(),
      'route.type': navigationEvent.type
    };

    // Add 'from' attribute only if it exists
    if (navigationEvent.from) {
      attributes['navigation.from'] = navigationEvent.from;
    }

    return {
      id: this.generateEventId(),
      sessionId: '', // Will be set by EdgeTelemetry
      eventName: 'navigation.to',
      timestamp: new Date(navigationEvent.timestamp),
      attributes: attributes
    };
  }

  /**
   * Handle screen duration events from ScreenDurationTracker
   */
  private handleScreenDurationEvent(event: TelemetryEvent): void {
    this.onTelemetryEvent(event);

    if (this.debugMode) {
      console.log('NavigationTracker: Tracked screen duration event:', event);
    }
  }

  /**
   * Set routes to ignore during tracking
   */
  setIgnoredRoutes(routes: string[]): void {
    this.ignoredRoutes = new Set(routes);
    
    if (this.debugMode) {
      console.log('NavigationTracker: Set ignored routes:', routes);
    }
  }

  /**
   * Add a route to ignore list
   */
  addIgnoredRoute(route: string): void {
    this.ignoredRoutes.add(route);
    
    if (this.debugMode) {
      console.log('NavigationTracker: Added ignored route:', route);
    }
  }

  /**
   * Remove a route from ignore list
   */
  removeIgnoredRoute(route: string): void {
    this.ignoredRoutes.delete(route);
    
    if (this.debugMode) {
      console.log('NavigationTracker: Removed ignored route:', route);
    }
  }

  /**
   * Get current screen being tracked
   */
  getCurrentScreen(): string | null {
    return this.screenDurationTracker.getCurrentScreen();
  }

  /**
   * Get screen duration statistics
   */
  getScreenDurationStats(): Record<string, any> {
    return this.screenDurationTracker.getStats();
  }

  /**
   * Dispose of the tracker
   */
  dispose(): void {
    this.screenDurationTracker.dispose();
    this.ignoredRoutes.clear();

    if (this.debugMode) {
      console.log('NavigationTracker: Disposed');
    }
  }

  /**
   * Generate a unique event ID
   */
  private generateEventId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 10);
    return `nav_${timestamp}_${random}`;
  }
}
