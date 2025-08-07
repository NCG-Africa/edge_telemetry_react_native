import type { NavigationState, PartialState, NavigationContainerRef, EventArg } from '@react-navigation/native';
import type { NavigationEvent, NavigationMethod, RouteType } from '../types/NavigationTypes';
import { NavigationTracker } from '../tracking/NavigationTracker';

/**
 * ReactNavigationObserver - Integrates with React Navigation v6+ to automatically track navigation events
 * Provides identical functionality to Flutter's NavigationObserver
 */
export class ReactNavigationObserver {
  private navigationTracker: NavigationTracker;
  private navigationRef: NavigationContainerRef<any> | null = null;
  private currentRoute: string | null = null;
  private isInitialized = false;
  private debugMode = false;

  constructor(navigationTracker: NavigationTracker, debugMode = false) {
    this.navigationTracker = navigationTracker;
    this.debugMode = debugMode;
  }

  /**
   * Initialize the observer with a navigation container reference
   */
  initialize(navigationRef: NavigationContainerRef<any>): void {
    if (this.isInitialized) {
      if (this.debugMode) {
        console.warn('ReactNavigationObserver: Already initialized');
      }
      return;
    }

    this.navigationRef = navigationRef;
    this.setupNavigationListeners();
    this.isInitialized = true;

    if (this.debugMode) {
      console.log('ReactNavigationObserver: Initialized with navigation ref');
    }
  }

  /**
   * Setup navigation state change listeners
   */
  private setupNavigationListeners(): void {
    if (!this.navigationRef) {
      return;
    }

    // Listen for navigation state changes
    this.navigationRef.addListener('state', this.handleNavigationStateChange.bind(this));

    // Get initial state
    const initialState = this.navigationRef.getRootState();
    if (initialState) {
      this.handleInitialNavigation(initialState);
    }
  }

  /**
   * Handle initial navigation state
   */
  private handleInitialNavigation(state: NavigationState): void {
    const currentRoute = this.getCurrentRouteFromState(state);
    if (currentRoute) {
      this.currentRoute = currentRoute.name;
      
      const navigationEvent: NavigationEvent = {
        to: currentRoute.name,
        from: null,
        method: 'initial' as NavigationMethod,
        type: this.determineRouteType(currentRoute),
        timestamp: Date.now(),
        routeParams: currentRoute.params || {}
      };

      this.navigationTracker.trackNavigationEvent(navigationEvent);

      if (this.debugMode) {
        console.log('ReactNavigationObserver: Initial navigation to:', currentRoute.name);
      }
    }
  }

  /**
   * Handle navigation state changes
   */
  private handleNavigationStateChange = (e: EventArg<'state', false, any>): void => {
    const state = e.data?.state;
    if (!state) {
      return;
    }
    
    const currentRoute = this.getCurrentRouteFromState(state);
    
    if (!currentRoute) {
      return;
    }

    const newRouteName = currentRoute.name;
    const previousRoute = this.currentRoute;

    // Only track if route actually changed
    if (newRouteName !== previousRoute) {
      const navigationMethod = this.determineNavigationMethod(state, previousRoute, newRouteName);
      
      const navigationEvent: NavigationEvent = {
        to: newRouteName,
        from: previousRoute,
        method: navigationMethod,
        type: this.determineRouteType(currentRoute),
        timestamp: Date.now(),
        routeParams: currentRoute.params || {}
      };

      this.navigationTracker.trackNavigationEvent(navigationEvent);
      this.currentRoute = newRouteName;

      if (this.debugMode) {
        console.log('ReactNavigationObserver: Navigation from', previousRoute, 'to', newRouteName, 'via', navigationMethod);
      }
    }
  };

  /**
   * Get current route from navigation state
   */
  private getCurrentRouteFromState(state: NavigationState | PartialState<NavigationState>): any {
    if (!state || !state.routes || state.routes.length === 0) {
      return null;
    }

    const route = state.routes[state.index || 0];
    
    // Check if route exists
    if (!route) {
      return null;
    }
    
    // Handle nested navigators
    if (route.state) {
      return this.getCurrentRouteFromState(route.state);
    }

    return route;
  }

  /**
   * Determine navigation method based on state changes
   */
  private determineNavigationMethod(
    state: NavigationState,
    previousRoute: string | null,
    newRoute: string
  ): NavigationMethod {
    if (!previousRoute) {
      return 'initial';
    }

    // Check if this is a back navigation (pop)
    if (this.isBackNavigation(state)) {
      return 'pop';
    }

    // Check if this is a replace operation
    if (this.isReplaceNavigation(state, previousRoute, newRoute)) {
      return 'replace';
    }

    // Check if this is a reset operation
    if (this.isResetNavigation(state)) {
      return 'reset';
    }

    // Check if this is a tab switch
    if (this.isTabSwitch(state)) {
      return 'switch';
    }

    // Default to push
    return 'push';
  }

  /**
   * Determine if navigation is a back operation
   */
  private isBackNavigation(_state: NavigationState): boolean {
    // This is a heuristic - React Navigation doesn't provide direct back detection
    // We can improve this by tracking route stack depth
    return false; // Simplified for now
  }

  /**
   * Determine if navigation is a replace operation
   */
  private isReplaceNavigation(_state: NavigationState, _previousRoute: string, _newRoute: string): boolean {
    // Check if route stack size remained the same but route changed
    return false; // Simplified for now
  }

  /**
   * Determine if navigation is a reset operation
   */
  private isResetNavigation(state: NavigationState): boolean {
    // Check if route stack was reset
    return state.routes.length === 1;
  }

  /**
   * Determine if navigation is a tab switch
   */
  private isTabSwitch(state: NavigationState): boolean {
    // Check if this is within a tab navigator
    return state.type === 'tab';
  }

  /**
   * Determine route type based on route configuration
   */
  private determineRouteType(route: any): RouteType {
    // Check if route has nested state (indicates nested navigator)
    if (route.state) {
      return 'nested_navigator';
    }
    
    return 'screen';
  }

  /**
   * Get current route name
   */
  getCurrentRoute(): string | null {
    return this.currentRoute;
  }

  /**
   * Dispose of the observer
   */
  dispose(): void {
    if (this.navigationRef) {
      this.navigationRef.removeListener('state', this.handleNavigationStateChange);
    }
    
    this.navigationRef = null;
    this.currentRoute = null;
    this.isInitialized = false;

    if (this.debugMode) {
      console.log('ReactNavigationObserver: Disposed');
    }
  }
}
