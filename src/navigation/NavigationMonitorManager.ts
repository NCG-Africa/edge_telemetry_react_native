import type { NavigationContainerRef } from '@react-navigation/native';
import type { TelemetryEvent } from '../core/models/TelemetryEvent';
import type { NavigationConfig, ManualNavigationOptions } from './types/NavigationTypes';
import { ReactNavigationObserver } from './observers/ReactNavigationObserver';
import { ManualNavigationObserver } from './observers/ManualNavigationObserver';
import { NavigationTracker } from './tracking/NavigationTracker';

/**
 * NavigationMonitorManager - Main coordinator for navigation tracking
 * Manages both automatic React Navigation tracking and manual tracking
 */
export class NavigationMonitorManager {
  private navigationTracker: NavigationTracker;
  private reactNavigationObserver: ReactNavigationObserver;
  private manualNavigationObserver: ManualNavigationObserver;
  private config: NavigationConfig;
  private isInitialized = false;

  constructor(
    onTelemetryEvent: (event: TelemetryEvent) => void,
    config: Partial<NavigationConfig> = {}
  ) {
    // Set default configuration
    this.config = {
      enableAutomaticTracking: true,
      enableScreenDuration: true,
      enableRouteParams: true,
      ignoredRoutes: [],
      debugMode: false,
      ...config
    };

    // Initialize navigation tracker
    this.navigationTracker = new NavigationTracker(
      onTelemetryEvent,
      this.config.enableScreenDuration,
      this.config.debugMode
    );

    // Initialize observers
    this.reactNavigationObserver = new ReactNavigationObserver(
      this.navigationTracker,
      this.config.debugMode
    );

    this.manualNavigationObserver = new ManualNavigationObserver(
      this.navigationTracker,
      this.config.debugMode
    );

    // Set ignored routes
    if (this.config.ignoredRoutes.length > 0) {
      this.navigationTracker.setIgnoredRoutes(this.config.ignoredRoutes);
    }

    if (this.config.debugMode) {
      console.log('NavigationMonitorManager: Initialized with config:', this.config);
    }
  }

  /**
   * Initialize automatic React Navigation tracking
   */
  initializeReactNavigation(navigationRef: NavigationContainerRef<any>): void {
    if (!this.config.enableAutomaticTracking) {
      if (this.config.debugMode) {
        console.log('NavigationMonitorManager: Automatic tracking disabled');
      }
      return;
    }

    this.reactNavigationObserver.initialize(navigationRef);
    this.isInitialized = true;

    if (this.config.debugMode) {
      console.log('NavigationMonitorManager: React Navigation tracking initialized');
    }
  }

  /**
   * Track manual navigation (for non-React Navigation apps or custom tracking)
   */
  trackManualNavigation(options: ManualNavigationOptions): void {
    this.manualNavigationObserver.navigateTo(options);
  }

  /**
   * Track navigation with push method
   */
  trackPush(screenName: string, params?: Record<string, any>): void {
    this.manualNavigationObserver.push(screenName, params);
  }

  /**
   * Track navigation with pop method
   */
  trackPop(screenName?: string): void {
    this.manualNavigationObserver.pop(screenName);
  }

  /**
   * Track navigation with replace method
   */
  trackReplace(screenName: string, params?: Record<string, any>): void {
    this.manualNavigationObserver.replace(screenName, params);
  }

  /**
   * Track navigation with reset method
   */
  trackReset(screenName: string, params?: Record<string, any>): void {
    this.manualNavigationObserver.reset(screenName, params);
  }

  /**
   * Track tab switch navigation
   */
  trackTabSwitch(tabName: string, params?: Record<string, any>): void {
    this.manualNavigationObserver.switchTab(tabName, params);
  }

  /**
   * Set initial screen
   */
  setInitialScreen(screenName: string, params?: Record<string, any>): void {
    this.manualNavigationObserver.setInitialScreen(screenName, params);
  }

  /**
   * Get current screen name
   */
  getCurrentScreen(): string | null {
    // Try React Navigation observer first, then manual observer
    return this.reactNavigationObserver.getCurrentRoute() || 
           this.manualNavigationObserver.getCurrentRoute();
  }

  /**
   * Get screen duration statistics
   */
  getScreenDurationStats(): Record<string, any> {
    return this.navigationTracker.getScreenDurationStats();
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<NavigationConfig>): void {
    this.config = { ...this.config, ...newConfig };

    // Update ignored routes if changed
    if (newConfig.ignoredRoutes) {
      this.navigationTracker.setIgnoredRoutes(newConfig.ignoredRoutes);
    }

    if (this.config.debugMode) {
      console.log('NavigationMonitorManager: Updated config:', this.config);
    }
  }

  /**
   * Add route to ignore list
   */
  addIgnoredRoute(route: string): void {
    this.config.ignoredRoutes.push(route);
    this.navigationTracker.addIgnoredRoute(route);
  }

  /**
   * Remove route from ignore list
   */
  removeIgnoredRoute(route: string): void {
    this.config.ignoredRoutes = this.config.ignoredRoutes.filter(r => r !== route);
    this.navigationTracker.removeIgnoredRoute(route);
  }

  /**
   * Get current configuration
   */
  getConfig(): NavigationConfig {
    return { ...this.config };
  }

  /**
   * Get navigation tracking status
   */
  getStatus(): Record<string, any> {
    return {
      enabled: this.config.enableAutomaticTracking,
      initialized: this.isInitialized,
      currentScreen: this.getCurrentScreen(),
      screenDurationEnabled: this.config.enableScreenDuration,
      routeParamsEnabled: this.config.enableRouteParams,
      ignoredRoutes: this.config.ignoredRoutes,
      screenStats: this.getScreenDurationStats()
    };
  }

  /**
   * Enable or disable navigation tracking
   */
  setEnabled(enabled: boolean): void {
    this.config.enableAutomaticTracking = enabled;

    if (this.config.debugMode) {
      console.log('NavigationMonitorManager: Set enabled to:', enabled);
    }
  }

  /**
   * Enable or disable screen duration tracking
   */
  setScreenDurationEnabled(enabled: boolean): void {
    this.config.enableScreenDuration = enabled;
    // Note: This would require recreating the NavigationTracker to change screen duration tracking
    // For now, we just update the config

    if (this.config.debugMode) {
      console.log('NavigationMonitorManager: Set screen duration enabled to:', enabled);
    }
  }

  /**
   * Dispose of the manager and clean up resources
   */
  dispose(): void {
    this.reactNavigationObserver.dispose();
    this.manualNavigationObserver.dispose();
    this.navigationTracker.dispose();
    this.isInitialized = false;

    if (this.config.debugMode) {
      console.log('NavigationMonitorManager: Disposed');
    }
  }
}
