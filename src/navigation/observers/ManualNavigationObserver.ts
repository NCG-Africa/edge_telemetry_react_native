import type { NavigationEvent, NavigationMethod, RouteType, ManualNavigationOptions } from '../types/NavigationTypes';
import { NavigationTracker } from '../tracking/NavigationTracker';

/**
 * ManualNavigationObserver - Fallback manual tracking for non-React Navigation apps
 * Provides identical functionality to Flutter's manual navigation tracking
 */
export class ManualNavigationObserver {
  private navigationTracker: NavigationTracker;
  private currentRoute: string | null = null;
  private debugMode = false;

  constructor(navigationTracker: NavigationTracker, debugMode = false) {
    this.navigationTracker = navigationTracker;
    this.debugMode = debugMode;
  }

  /**
   * Manually track navigation to a screen
   */
  navigateTo(options: ManualNavigationOptions): void {
    const navigationEvent: NavigationEvent = {
      to: options.to,
      from: options.from || this.currentRoute,
      method: options.method || 'push',
      type: options.type || 'screen',
      timestamp: Date.now(),
      routeParams: options.params || {}
    };

    this.navigationTracker.trackNavigationEvent(navigationEvent);
    this.currentRoute = options.to;

    if (this.debugMode) {
      console.log('ManualNavigationObserver: Tracked manual navigation:', navigationEvent);
    }
  }

  /**
   * Track navigation with push method
   */
  push(screenName: string, params?: Record<string, any>): void {
    this.navigateTo({
      to: screenName,
      method: 'push',
      type: 'screen',
      params
    });
  }

  /**
   * Track navigation with pop method
   */
  pop(screenName?: string): void {
    this.navigateTo({
      to: screenName || 'previous_screen',
      method: 'pop',
      type: 'screen'
    });
  }

  /**
   * Track navigation with replace method
   */
  replace(screenName: string, params?: Record<string, any>): void {
    this.navigateTo({
      to: screenName,
      method: 'replace',
      type: 'screen',
      params
    });
  }

  /**
   * Track navigation with reset method
   */
  reset(screenName: string, params?: Record<string, any>): void {
    this.navigateTo({
      to: screenName,
      method: 'reset',
      type: 'screen',
      params
    });
  }

  /**
   * Track tab switch navigation
   */
  switchTab(tabName: string, params?: Record<string, any>): void {
    this.navigateTo({
      to: tabName,
      method: 'switch',
      type: 'screen',
      params
    });
  }

  /**
   * Track initial screen load
   */
  setInitialScreen(screenName: string, params?: Record<string, any>): void {
    this.navigateTo({
      to: screenName,
      method: 'initial',
      type: 'screen',
      params
    });
  }

  /**
   * Get current route name
   */
  getCurrentRoute(): string | null {
    return this.currentRoute;
  }

  /**
   * Set current route without tracking (for synchronization)
   */
  setCurrentRoute(routeName: string): void {
    this.currentRoute = routeName;
    
    if (this.debugMode) {
      console.log('ManualNavigationObserver: Set current route to:', routeName);
    }
  }

  /**
   * Clear current route
   */
  clearCurrentRoute(): void {
    this.currentRoute = null;
    
    if (this.debugMode) {
      console.log('ManualNavigationObserver: Cleared current route');
    }
  }

  /**
   * Dispose of the observer
   */
  dispose(): void {
    this.currentRoute = null;

    if (this.debugMode) {
      console.log('ManualNavigationObserver: Disposed');
    }
  }
}
