/**
 * Navigation tracking module exports
 * Phase 8: Navigation Tracking System
 */

// Main manager
export { NavigationMonitorManager } from './NavigationMonitorManager';

// Observers
export { ReactNavigationObserver } from './observers/ReactNavigationObserver';
export { ManualNavigationObserver } from './observers/ManualNavigationObserver';

// Tracking components
export { NavigationTracker } from './tracking/NavigationTracker';
export { ScreenDurationTracker } from './tracking/ScreenDurationTracker';

// React components
export { NavigationContainerWrapper, useNavigationTracking } from './components/NavigationContainerWrapper';

// Types
export type {
  NavigationMethod,
  RouteType,
  NavigationEvent,
  ScreenDurationEvent,
  NavigationTelemetryAttributes,
  ScreenDurationTelemetryAttributes,
  ManualNavigationOptions,
  NavigationConfig
} from './types/NavigationTypes';
