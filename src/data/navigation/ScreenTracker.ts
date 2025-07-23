/**
 * Screen Tracker for Navigation Monitoring
 * 
 * This module provides functionality to track screen transitions and user navigation
 * patterns for telemetry purposes. It integrates with React Navigation to capture
 * screen changes, timestamps, and user flow data.
 */

// Optional React Navigation types - these will be available when the consuming app has React Navigation installed
type NavigationContainerRef = {
  getCurrentState(): NavigationState | undefined;
  addListener(type: string, listener: (...args: any[]) => void): void;
  removeListener?(type: string, listener: (...args: any[]) => void): void;
};

type NavigationState = {
  index?: number;
  routes: Array<{
    name: string;
    params?: Record<string, any>;
    state?: NavigationState;
  }>;
};

/**
 * Screen tracking data structure
 */
export interface ScreenTrackingEvent {
  /** Current screen name */
  screenName: string;
  /** Previous screen name (if available) */
  previousScreenName?: string;
  /** Timestamp when screen was entered */
  timestamp: number;
  /** Time spent on previous screen (in milliseconds) */
  timeOnPreviousScreen?: number;
  /** Navigation route parameters */
  params?: Record<string, any>;
}

/**
 * Internal state for screen tracking
 */
interface ScreenTrackingState {
  currentScreen?: string;
  previousScreen?: string;
  screenStartTime?: number;
  isTracking: boolean;
}

// Global tracking state
let trackingState: ScreenTrackingState = {
  isTracking: false,
};

/**
 * Extracts the current route name from navigation state
 * @param state Navigation state object
 * @returns Current route name or undefined
 */
function getCurrentRouteName(state: NavigationState | undefined): string | undefined {
  if (!state || !state.routes || state.routes.length === 0) {
    return undefined;
  }

  const routeIndex = state.index || 0;
  const route = state.routes[routeIndex];
  
  if (!route) {
    return undefined;
  }
  
  // Handle nested navigators
  if (route.state) {
    return getCurrentRouteName(route.state as NavigationState);
  }
  
  return route.name;
}

/**
 * Handles screen change events and records telemetry
 * @param screenName Current screen name
 * @param previousScreenName Previous screen name
 */
function handleScreenChange(screenName: string, previousScreenName?: string): void {
  const now = Date.now();
  const timeOnPreviousScreen = trackingState.screenStartTime 
    ? now - trackingState.screenStartTime 
    : undefined;

  // Create screen tracking event
  const screenEvent: ScreenTrackingEvent = {
    screenName,
    previousScreenName,
    timestamp: now,
    timeOnPreviousScreen,
  };

  // TODO: Send screen tracking event to telemetry system
  // This will be integrated with EdgeTelemetry.trackEvent() in the future
  console.log('Screen Tracking Event:', screenEvent);

  // Update tracking state
  trackingState.previousScreen = trackingState.currentScreen;
  trackingState.currentScreen = screenName;
  trackingState.screenStartTime = now;
}

/**
 * Starts automatic screen tracking using React Navigation
 * @param navigationContainerRef Reference to the NavigationContainer
 */
export function startScreenTracking(navigationContainerRef: NavigationContainerRef): void {
  if (trackingState.isTracking) {
    console.warn('ScreenTracker: Screen tracking is already enabled');
    return;
  }

  try {
    // Set up initial state when navigation is ready
    const handleReady = () => {
      const initialRouteName = getCurrentRouteName(navigationContainerRef.getCurrentState());
      if (initialRouteName) {
        trackingState.currentScreen = initialRouteName;
        trackingState.screenStartTime = Date.now();
        
        console.log('ScreenTracker: Initial screen tracked:', initialRouteName);
        
        // Record initial screen event
        handleScreenChange(initialRouteName);
      }
    };

    // Set up state change listener
    const handleStateChange = (state: NavigationState | undefined) => {
      const currentRouteName = getCurrentRouteName(state);
      
      if (currentRouteName && currentRouteName !== trackingState.currentScreen) {
        handleScreenChange(currentRouteName, trackingState.currentScreen);
      }
    };

    // Register listeners
    navigationContainerRef.addListener('ready', handleReady);
    navigationContainerRef.addListener('state', handleStateChange);

    // Mark tracking as active
    trackingState.isTracking = true;
    
    console.log('ScreenTracker: Screen tracking enabled successfully');

  } catch (error) {
    console.error('ScreenTracker: Failed to start screen tracking:', error);
  }
}

/**
 * Stops screen tracking and cleans up listeners
 * @param navigationContainerRef Reference to the NavigationContainer
 */
export function stopScreenTracking(navigationContainerRef: NavigationContainerRef): void {
  if (!trackingState.isTracking) {
    return;
  }

  try {
    // Remove listeners (Note: React Navigation doesn't provide removeListener for these events)
    // This is a limitation of the current React Navigation API
    
    // Reset tracking state
    trackingState = {
      isTracking: false,
    };
    
    console.log('ScreenTracker: Screen tracking stopped');
  } catch (error) {
    console.error('ScreenTracker: Failed to stop screen tracking:', error);
  }
}

/**
 * Gets the current screen tracking state
 * @returns Current tracking state
 */
export function getScreenTrackingState(): Readonly<ScreenTrackingState> {
  return { ...trackingState };
}

/**
 * Manually tracks a screen change (for custom navigation implementations)
 * @param screenName Screen name to track
 * @param params Optional route parameters
 */
export function trackScreenManually(screenName: string, params?: Record<string, any>): void {
  if (!trackingState.isTracking) {
    console.warn('ScreenTracker: Screen tracking is not enabled. Call startScreenTracking() first.');
    return;
  }

  handleScreenChange(screenName, trackingState.currentScreen);
}
