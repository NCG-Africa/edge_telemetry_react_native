/**
 * Navigation types matching Flutter SDK exactly for backend compatibility
 */

/**
 * Navigation methods - must match Flutter's NavigationObserver
 */
export type NavigationMethod = 
  | 'push'
  | 'pop'
  | 'replace'
  | 'reset'
  | 'switch'
  | 'initial';

/**
 * Route types - must match Flutter's route classification
 */
export type RouteType = 
  | 'screen'
  | 'nested_navigator';

/**
 * Navigation event structure - must match Flutter exactly
 */
export interface NavigationEvent {
  to: string;
  from: string | null;
  method: NavigationMethod;
  type: RouteType;
  timestamp: number;
  routeParams?: Record<string, any>;
}

/**
 * Screen duration event structure - must match Flutter exactly
 */
export interface ScreenDurationEvent {
  screenName: string;
  duration: number;
  exitMethod: NavigationMethod;
  timestamp: number;
  unit: 'milliseconds';
}

/**
 * Navigation telemetry attributes - must match Flutter exactly
 */
export interface NavigationTelemetryAttributes {
  'navigation.to': string;
  'navigation.from'?: string;
  'navigation.method': NavigationMethod;
  'navigation.type': RouteType;
  'navigation.timestamp': string;
  'route.type': RouteType;
}

/**
 * Screen duration telemetry attributes - must match Flutter exactly
 */
export interface ScreenDurationTelemetryAttributes {
  'screen.name': string;
  'navigation.exit_method': NavigationMethod;
  'metric.unit': 'milliseconds';
  'performance.screen_duration': string;
}

/**
 * Manual navigation tracking options
 */
export interface ManualNavigationOptions {
  from?: string;
  to: string;
  method?: NavigationMethod;
  type?: RouteType;
  params?: Record<string, any>;
}

/**
 * Navigation configuration options
 */
export interface NavigationConfig {
  enableAutomaticTracking: boolean;
  enableScreenDuration: boolean;
  enableRouteParams: boolean;
  ignoredRoutes: string[];
  debugMode: boolean;
}
