import type { NavigationMethod, ScreenDurationEvent } from '../types/NavigationTypes';
import type { TelemetryEvent } from '../../core/models/TelemetryEvent';

/**
 * ScreenDurationTracker - Tracks time spent on each screen
 * Provides identical functionality to Flutter's screen duration tracking
 */
export class ScreenDurationTracker {
  private currentScreen: string | null = null;
  private screenStartTime: number | null = null;
  private onTelemetryEvent: (event: TelemetryEvent) => void;
  private enabled = true;
  private debugMode = false;
  private screenStats: Map<string, { totalTime: number; visitCount: number }> = new Map();

  constructor(
    onTelemetryEvent: (event: TelemetryEvent) => void,
    enabled = true,
    debugMode = false
  ) {
    this.onTelemetryEvent = onTelemetryEvent;
    this.enabled = enabled;
    this.debugMode = debugMode;
  }

  /**
   * Start tracking duration for a screen
   */
  startScreen(screenName: string): void {
    if (!this.enabled) {
      return;
    }

    // End previous screen if exists
    if (this.currentScreen && this.screenStartTime) {
      this.endScreen(this.currentScreen, 'push'); // Default to push if no explicit method
    }

    this.currentScreen = screenName;
    this.screenStartTime = Date.now();

    if (this.debugMode) {
      console.log('ScreenDurationTracker: Started tracking screen:', screenName);
    }
  }

  /**
   * End tracking duration for a screen
   */
  endScreen(screenName: string, exitMethod: NavigationMethod): void {
    if (!this.enabled || !this.screenStartTime || this.currentScreen !== screenName) {
      return;
    }

    const endTime = Date.now();
    const duration = endTime - this.screenStartTime;

    // Update screen statistics
    this.updateScreenStats(screenName, duration);

    // Create screen duration event
    const screenDurationEvent: ScreenDurationEvent = {
      screenName,
      duration,
      exitMethod,
      timestamp: endTime,
      unit: 'milliseconds'
    };

    // Create telemetry event matching Flutter format
    const telemetryEvent = this.createScreenDurationTelemetryEvent(screenDurationEvent);
    
    // Send telemetry event
    this.onTelemetryEvent(telemetryEvent);

    // Reset current tracking
    this.currentScreen = null;
    this.screenStartTime = null;

    if (this.debugMode) {
      console.log('ScreenDurationTracker: Ended screen tracking:', {
        screen: screenName,
        duration,
        exitMethod
      });
    }
  }

  /**
   * Create screen duration telemetry event matching Flutter format exactly
   */
  private createScreenDurationTelemetryEvent(event: ScreenDurationEvent): TelemetryEvent {
    const attributes: Record<string, string> = {
      'screen.name': event.screenName,
      'navigation.exit_method': event.exitMethod,
      'metric.unit': event.unit,
      'performance.screen_duration': event.duration.toString()
    };

    return {
      id: this.generateEventId(),
      sessionId: '', // Will be set by EdgeTelemetry
      eventName: 'performance.screen_duration',
      timestamp: new Date(event.timestamp),
      attributes: attributes
    };
  }

  /**
   * Update screen statistics
   */
  private updateScreenStats(screenName: string, duration: number): void {
    const existing = this.screenStats.get(screenName);
    if (existing) {
      existing.totalTime += duration;
      existing.visitCount += 1;
    } else {
      this.screenStats.set(screenName, {
        totalTime: duration,
        visitCount: 1
      });
    }
  }

  /**
   * Get current screen being tracked
   */
  getCurrentScreen(): string | null {
    return this.currentScreen;
  }

  /**
   * Get current screen duration (if actively tracking)
   */
  getCurrentScreenDuration(): number | null {
    if (!this.currentScreen || !this.screenStartTime) {
      return null;
    }
    return Date.now() - this.screenStartTime;
  }

  /**
   * Get screen duration statistics
   */
  getStats(): Record<string, any> {
    const stats: Record<string, any> = {};
    
    for (const [screenName, data] of this.screenStats.entries()) {
      stats[screenName] = {
        totalTime: data.totalTime,
        visitCount: data.visitCount,
        averageTime: Math.round(data.totalTime / data.visitCount)
      };
    }

    return {
      screens: stats,
      currentScreen: this.currentScreen,
      currentDuration: this.getCurrentScreenDuration(),
      totalScreens: this.screenStats.size
    };
  }

  /**
   * Clear all screen statistics
   */
  clearStats(): void {
    this.screenStats.clear();
    
    if (this.debugMode) {
      console.log('ScreenDurationTracker: Cleared all statistics');
    }
  }

  /**
   * Enable or disable screen duration tracking
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    
    // If disabling and currently tracking, end current screen
    if (!enabled && this.currentScreen && this.screenStartTime) {
      this.endScreen(this.currentScreen, 'switch'); // Use switch as generic exit method
    }

    if (this.debugMode) {
      console.log('ScreenDurationTracker: Set enabled to:', enabled);
    }
  }

  /**
   * Check if tracking is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Dispose of the tracker
   */
  dispose(): void {
    // End current screen if tracking
    if (this.currentScreen && this.screenStartTime) {
      this.endScreen(this.currentScreen, 'reset'); // Use reset as disposal exit method
    }

    this.screenStats.clear();
    this.currentScreen = null;
    this.screenStartTime = null;

    if (this.debugMode) {
      console.log('ScreenDurationTracker: Disposed');
    }
  }

  /**
   * Generate a unique event ID
   */
  private generateEventId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 10);
    return `screen_duration_${timestamp}_${random}`;
  }
}
