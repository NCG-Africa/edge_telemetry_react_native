import type { TelemetryConfig, TelemetryInitConfig } from './core/config/TelemetryConfig';
import { DEFAULT_CONFIG } from './core/config/TelemetryConfig';
import type { UserProfile } from './core/models/UserProfile';
import type { TelemetryEvent } from './core/models/TelemetryEvent';
import { AttributeConverter } from './core/AttributeConverter';
import { UserIdManager } from './managers/UserIdManager';
import { SessionManager } from './managers/SessionManager';
import { ReactNativeDeviceInfoCollector } from './collectors/ReactNativeDeviceInfoCollector';
import { NetworkMonitorManager } from './http/NetworkMonitorManager';
import { NavigationMonitorManager } from './navigation/NavigationMonitorManager';
import type { ManualNavigationOptions } from './navigation/types/NavigationTypes';
import type { NavigationContainerRef } from '@react-navigation/native';

/**
 * EdgeTelemetry - Main SDK class
 * Must match Flutter SDK public API exactly for backend compatibility
 * 
 * Provides automatic telemetry collection with zero additional code after initialization
 */
export class EdgeTelemetry {
  private static instance: EdgeTelemetry;
  private initialized = false;
  private config?: TelemetryConfig;
  
  // Core managers
  private userIdManager: UserIdManager;
  private sessionManager: SessionManager;
  private deviceInfoCollector: ReactNativeDeviceInfoCollector;
  private networkMonitorManager?: NetworkMonitorManager;
  private navigationMonitorManager?: NavigationMonitorManager;
  
  // Event queue for batching
  private eventQueue: TelemetryEvent[] = [];
  private batchTimer?: any;

  private constructor() {
    this.userIdManager = UserIdManager.getInstance();
    this.sessionManager = SessionManager.getInstance();
    this.deviceInfoCollector = new ReactNativeDeviceInfoCollector();
  }

  /**
   * Get the singleton instance
   */
  static getInstance(): EdgeTelemetry {
    if (!EdgeTelemetry.instance) {
      EdgeTelemetry.instance = new EdgeTelemetry();
    }
    return EdgeTelemetry.instance;
  }

  /**
   * Initialize the EdgeTelemetry SDK
   * Must mirror Flutter initialization exactly
   */
  static async initialize(initConfig: TelemetryInitConfig): Promise<void> {
    const instance = EdgeTelemetry.getInstance();
    
    if (instance.initialized) {
      console.warn('EdgeTelemetry: SDK already initialized');
      return;
    }

    try {
      // 1. Create full configuration with defaults
      const config: TelemetryConfig = {
        ...DEFAULT_CONFIG,
        serviceName: initConfig.serviceName,
        endpoint: initConfig.endpoint,
        debugMode: initConfig.debugMode ?? DEFAULT_CONFIG.debugMode,
        globalAttributes: initConfig.globalAttributes ?? DEFAULT_CONFIG.globalAttributes,
        batchTimeout: initConfig.batchTimeout ?? DEFAULT_CONFIG.batchTimeout,
        maxBatchSize: initConfig.maxBatchSize ?? DEFAULT_CONFIG.maxBatchSize,
        enableNetworkMonitoring: initConfig.enableNetworkMonitoring ?? DEFAULT_CONFIG.enableNetworkMonitoring,
        enablePerformanceMonitoring: initConfig.enablePerformanceMonitoring ?? DEFAULT_CONFIG.enablePerformanceMonitoring,
        enableNavigationTracking: initConfig.enableNavigationTracking ?? DEFAULT_CONFIG.enableNavigationTracking,
        enableHttpMonitoring: initConfig.enableHttpMonitoring ?? DEFAULT_CONFIG.enableHttpMonitoring,
        enableLocalReporting: initConfig.enableLocalReporting ?? DEFAULT_CONFIG.enableLocalReporting,
        useJsonFormat: initConfig.useJsonFormat ?? DEFAULT_CONFIG.useJsonFormat,
        eventBatchSize: initConfig.eventBatchSize ?? DEFAULT_CONFIG.eventBatchSize,
      };

      instance.config = config;

      if (config.debugMode) {
        console.log('EdgeTelemetry: Initializing SDK with config:', config);
      }

      // 2. Initialize user ID manager
      await instance.userIdManager.getUserId();

      // 3. Collect device info
      const deviceInfo = await instance.deviceInfoCollector.collectAllDeviceInfo();
      const appInfo = await instance.deviceInfoCollector.collectAppInfo();

      // 4. Initialize session manager and start session
      await instance.sessionManager.loadSession();
      const sessionId = await instance.sessionManager.startSession(deviceInfo, appInfo);

      if (config.debugMode) {
        console.log('EdgeTelemetry: Session started with ID:', sessionId);
      }

      // 5. Setup automatic crash handling
      instance.setupGlobalErrorHandler();

      // 6. Setup HTTP monitoring if enabled
      if (config.httpMonitoring) {
        instance.networkMonitorManager = new NetworkMonitorManager(config);
        await instance.networkMonitorManager.initialize((events) => {
          instance.handleTelemetryEvents(events);
        });
        
        if (config.debugMode) {
          console.log('EdgeTelemetry: HTTP monitoring initialized');
        }
      }

      // 7. Setup navigation tracking if enabled
      if (config.enableNavigationTracking) {
        instance.navigationMonitorManager = new NavigationMonitorManager(
          (event) => instance.handleNavigationTelemetryEvent(event),
          {
            enableAutomaticTracking: true,
            enableScreenDuration: config.enablePerformanceMonitoring,
            enableRouteParams: true,
            ignoredRoutes: [],
            debugMode: config.debugMode
          }
        );
        
        if (config.debugMode) {
          console.log('EdgeTelemetry: Navigation tracking initialized');
        }
      }

      // 8. Setup batch processing
      instance.setupBatchProcessing();

      instance.initialized = true;

      if (config.debugMode) {
        console.log('EdgeTelemetry: SDK initialization complete');
      }

    } catch (error) {
      console.error('EdgeTelemetry: Failed to initialize SDK:', error);
      throw error;
    }
  }

  /**
   * Track a custom event with optional attributes
   * Public API - Must match Flutter exactly
   */
  trackEvent(eventName: string, attributes?: any): void {
    if (!this.initialized || !this.config) {
      console.warn('EdgeTelemetry: SDK not initialized. Call EdgeTelemetry.initialize() first.');
      return;
    }

    try {
      this.createTelemetryEvent(eventName, attributes).then(event => {
        this.queueEvent(event);
        this.sessionManager.recordEvent();

        if (this.config?.debugMode) {
          console.log('EdgeTelemetry: Event tracked:', eventName, attributes);
        }
      }).catch(error => {
        console.error('EdgeTelemetry: Failed to create telemetry event:', error);
      });
    } catch (error) {
      console.error('EdgeTelemetry: Failed to track event:', error);
    }
  }

  /**
   * Track a metric with numeric value
   * Public API - Must match Flutter exactly
   */
  trackMetric(metricName: string, value: number, attributes?: any): void {
    if (!this.initialized || !this.config) {
      console.warn('EdgeTelemetry: SDK not initialized. Call EdgeTelemetry.initialize() first.');
      return;
    }

    try {
      const metricAttributes = AttributeConverter.convertToStringMap(attributes || {});
      metricAttributes['metric.value'] = String(value);
      metricAttributes['metric.type'] = 'gauge'; // Default metric type

      this.createTelemetryEvent(`metric.${metricName}`, metricAttributes).then(event => {
        this.queueEvent(event);
        this.sessionManager.recordMetric();

        if (this.config?.debugMode) {
          console.log('EdgeTelemetry: Metric tracked:', metricName, value, attributes);
        }
      }).catch(error => {
        console.error('EdgeTelemetry: Failed to create metric event:', error);
      });
    } catch (error) {
      console.error('EdgeTelemetry: Failed to track metric:', error);
    }
  }

  /**
   * Track an error or exception
   * Public API - Must match Flutter exactly
   */
  trackError(error: Error, stackTrace?: string, attributes?: Record<string, string>): void {
    if (!this.initialized || !this.config) {
      console.warn('EdgeTelemetry: SDK not initialized. Call EdgeTelemetry.initialize() first.');
      return;
    }

    try {
      const errorAttributes = AttributeConverter.convertToStringMap(attributes || {});
      errorAttributes['error.message'] = error.message;
      errorAttributes['error.name'] = error.name;
      errorAttributes['error.stack'] = stackTrace || error.stack || 'No stack trace available';

      this.createTelemetryEvent('error.exception', errorAttributes).then(event => {
        this.queueEvent(event);
        this.sessionManager.recordError();

        if (this.config?.debugMode) {
          console.log('EdgeTelemetry: Error tracked:', error.message);
        }
      }).catch(trackingError => {
        console.error('EdgeTelemetry: Failed to create error event:', trackingError);
      });
    } catch (trackingError) {
      console.error('EdgeTelemetry: Failed to track error:', trackingError);
    }
  }

  /**
   * Set user profile information
   * Public API - Must match Flutter exactly
   */
  setUserProfile(profile: UserProfile): void {
    if (!this.initialized) {
      console.warn('EdgeTelemetry: SDK not initialized. Call EdgeTelemetry.initialize() first.');
      return;
    }

    try {
      this.userIdManager.setCustomUserId(profile.userId);
      
      // Track user profile update as an event
      const profileAttributes = AttributeConverter.convertToStringMap(profile.attributes);
      profileAttributes['user.id'] = profile.userId;
      if (profile.email) profileAttributes['user.email'] = profile.email;
      if (profile.name) profileAttributes['user.name'] = profile.name;

      this.trackEvent('user.profile_updated', profileAttributes);

      if (this.config?.debugMode) {
        console.log('EdgeTelemetry: User profile set:', profile.userId);
      }
    } catch (error) {
      console.error('EdgeTelemetry: Failed to set user profile:', error);
    }
  }

  /**
   * Clear user profile information
   * Public API - Must match Flutter exactly
   */
  clearUserProfile(): void {
    if (!this.initialized) {
      console.warn('EdgeTelemetry: SDK not initialized. Call EdgeTelemetry.initialize() first.');
      return;
    }

    try {
      this.userIdManager.clearCustomUserId();
      this.trackEvent('user.profile_cleared');

      if (this.config?.debugMode) {
        console.log('EdgeTelemetry: User profile cleared');
      }
    } catch (error) {
      console.error('EdgeTelemetry: Failed to clear user profile:', error);
    }
  }

  /**
   * Get current user ID
   * Public API - Must match Flutter exactly
   */
  get currentUserId(): string | null {
    if (!this.initialized) {
      return null;
    }

    try {
      return this.userIdManager.getCustomUserId() || null;
    } catch (error) {
      console.error('EdgeTelemetry: Failed to get current user ID:', error);
      return null;
    }
  }

  /**
   * Get current user profile attributes
   * Public API - Must match Flutter exactly
   */
  get currentUserProfile(): Record<string, string> {
    if (!this.initialized) {
      return {};
    }

    try {
      const userId = this.userIdManager.getCustomUserId();
      if (!userId) {
        return {};
      }

      return {
        'user.id': userId,
        // Additional profile attributes would be stored separately in a real implementation
      };
    } catch (error) {
      console.error('EdgeTelemetry: Failed to get current user profile:', error);
      return {};
    }
  }

  /**
   * Get current session information
   * Public API - Must match Flutter exactly
   */
  get currentSessionInfo(): Record<string, any> {
    if (!this.initialized) {
      return {};
    }

    try {
      return this.sessionManager.getCurrentSessionInfo();
    } catch (error) {
      console.error('EdgeTelemetry: Failed to get current session info:', error);
      return {};
    }
  }

  /**
   * Dispose of the SDK and clean up resources
   * Public API - Must match Flutter exactly
   */
  dispose(): void {
    if (!this.initialized) {
      return;
    }

    try {
      // Clear batch timer
      if (this.batchTimer) {
        clearTimeout(this.batchTimer);
        this.batchTimer = undefined;
      }

      // Flush remaining events
      this.flushEvents();

      // End current session
      this.sessionManager.endSession();

      // Clear global error handler
      this.clearGlobalErrorHandler();

      this.initialized = false;

      if (this.config?.debugMode) {
        console.log('EdgeTelemetry: SDK disposed');
      }
    } catch (error) {
      console.error('EdgeTelemetry: Error during disposal:', error);
    }
  }

  /**
   * Create a telemetry event with standard attributes
   */
  private async createTelemetryEvent(eventName: string, attributes?: any): Promise<TelemetryEvent> {
    const sessionId = this.sessionManager.getCurrentSessionId() || 'unknown';
    const userId = await this.userIdManager.getUserId();
    
    const eventAttributes = AttributeConverter.mergeAttributes(
      this.config?.globalAttributes || {},
      attributes || {}
    );

    const standardAttributes = AttributeConverter.addStandardAttributes(
      eventAttributes,
      sessionId,
      userId
    );

    return {
      id: this.generateEventId(),
      sessionId,
      eventName,
      timestamp: new Date(),
      attributes: AttributeConverter.validateStringMap(standardAttributes),
      userId,
    };
  }

  /**
   * Queue an event for batch processing
   */
  private queueEvent(event: TelemetryEvent): void {
    this.eventQueue.push(event);

    // Check if we should flush immediately
    if (this.eventQueue.length >= (this.config?.eventBatchSize || 30)) {
      this.flushEvents();
    }
  }

  /**
   * Setup batch processing timer
   */
  private setupBatchProcessing(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }

    const batchTimeout = this.config?.batchTimeout || 30000;
    this.batchTimer = setTimeout(() => {
      this.flushEvents();
      this.setupBatchProcessing(); // Restart timer
    }, batchTimeout);
  }

  /**
   * Flush queued events to the backend
   */
  private flushEvents(): void {
    if (this.eventQueue.length === 0) {
      return;
    }

    const eventsToFlush = [...this.eventQueue];
    this.eventQueue = [];

    if (this.config?.debugMode) {
      console.log(`EdgeTelemetry: Flushing ${eventsToFlush.length} events`);
    }

    // TODO: Implement actual event sending to backend
    // This will be implemented in Phase 6 with OpenTelemetry integration
    console.log('EdgeTelemetry: Events to send:', eventsToFlush);
  }

  /**
   * Setup global error handler for automatic crash detection
   */
  private setupGlobalErrorHandler(): void {
    // Handle unhandled promise rejections
    if (typeof global !== 'undefined' && 'addEventListener' in global) {
      (global as any).addEventListener('unhandledrejection', this.handleUnhandledRejection);
    }

    // Handle JavaScript errors
    if (typeof ErrorUtils !== 'undefined') {
      const originalHandler = ErrorUtils.getGlobalHandler();
      ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
        this.trackError(error, error.stack, {
          'error.is_fatal': String(isFatal || false),
          'error.source': 'global_handler'
        });
        
        // Call original handler
        if (originalHandler) {
          originalHandler(error, isFatal);
        }
      });
    }
  }

  /**
   * Clear global error handler
   */
  private clearGlobalErrorHandler(): void {
    if (typeof global !== 'undefined' && 'removeEventListener' in global) {
      (global as any).removeEventListener('unhandledrejection', this.handleUnhandledRejection);
    }
  }

  /**
   * Handle unhandled promise rejections
   */
  private handleUnhandledRejection = (event: any): void => {
    const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
    this.trackError(error, error.stack, {
      'error.source': 'unhandled_rejection'
    });
  };

  /**
   * Handle telemetry events from HTTP monitoring
   */
  private handleTelemetryEvents(events: TelemetryEvent[]): void {
    if (!this.initialized || !events.length) {
      return;
    }

    // Add events to queue for batch processing
    this.eventQueue.push(...events);

    if (this.config?.debugMode) {
      console.log(`EdgeTelemetry: Received ${events.length} HTTP telemetry events`);
    }

    // Check if we should flush immediately
    const maxBatchSize = this.config?.maxBatchSize || 100;
    if (this.eventQueue.length >= maxBatchSize) {
      this.flushEvents();
    }
  }

  /**
   * Handle single telemetry event from navigation tracking
   */
  private handleNavigationTelemetryEvent(event: TelemetryEvent): void {
    if (!this.initialized) {
      return;
    }

    // Set session ID if not already set
    if (!event.sessionId) {
      event.sessionId = this.sessionManager.getCurrentSession()?.sessionId || '';
    }

    // Set user ID if available (use custom user ID if set)
    const customUserId = this.userIdManager.getCustomUserId();
    if (!event.userId && customUserId) {
      event.userId = customUserId;
    }

    // Add to event queue
    this.eventQueue.push(event);

    if (this.config?.debugMode) {
      console.log('EdgeTelemetry: Received navigation telemetry event:', event.eventName);
    }

    // Check if we should flush immediately
    const maxBatchSize = this.config?.maxBatchSize || 100;
    if (this.eventQueue.length >= maxBatchSize) {
      this.flushEvents();
    }
  }

  /**
   * Install Axios interceptor for HTTP monitoring
   */
  installAxiosInterceptor(axiosInstance: any): void {
    if (!this.initialized) {
      console.warn('EdgeTelemetry: SDK not initialized, cannot install Axios interceptor');
      return;
    }

    if (this.networkMonitorManager) {
      this.networkMonitorManager.installAxiosInterceptor(axiosInstance);
    } else {
      console.warn('EdgeTelemetry: HTTP monitoring not enabled, cannot install Axios interceptor');
    }
  }

  /**
   * Get HTTP monitoring status and metrics
   */
  getHttpMonitoringStatus(): any {
    if (!this.networkMonitorManager) {
      return { enabled: false, message: 'HTTP monitoring not enabled' };
    }

    return this.networkMonitorManager.getStatus();
  }

  /**
   * Initialize React Navigation tracking
   * Public API - Must match Flutter exactly
   */
  initializeNavigationTracking(navigationRef: NavigationContainerRef<any>): void {
    if (!this.initialized) {
      console.warn('EdgeTelemetry: SDK not initialized, cannot initialize navigation tracking');
      return;
    }

    if (this.navigationMonitorManager) {
      this.navigationMonitorManager.initializeReactNavigation(navigationRef);
    } else {
      console.warn('EdgeTelemetry: Navigation tracking not enabled, cannot initialize React Navigation');
    }
  }

  /**
   * Track manual navigation (for non-React Navigation apps)
   * Public API - Must match Flutter exactly
   */
  trackManualNavigation(options: ManualNavigationOptions): void {
    if (!this.initialized) {
      console.warn('EdgeTelemetry: SDK not initialized, cannot track manual navigation');
      return;
    }

    if (this.navigationMonitorManager) {
      this.navigationMonitorManager.trackManualNavigation(options);
    } else {
      console.warn('EdgeTelemetry: Navigation tracking not enabled, cannot track manual navigation');
    }
  }

  /**
   * Get current screen name
   * Public API - Must match Flutter exactly
   */
  getCurrentScreen(): string | null {
    if (!this.navigationMonitorManager) {
      return null;
    }
    return this.navigationMonitorManager.getCurrentScreen();
  }

  /**
   * Get screen duration statistics
   * Public API - Must match Flutter exactly
   */
  getScreenDurationStats(): Record<string, any> {
    if (!this.navigationMonitorManager) {
      return {};
    }
    return this.navigationMonitorManager.getScreenDurationStats();
  }

  /**
   * Get navigation tracking status
   * Public API - Must match Flutter exactly
   */
  getNavigationTrackingStatus(): Record<string, any> {
    if (!this.navigationMonitorManager) {
      return { enabled: false, message: 'Navigation tracking not enabled' };
    }
    return this.navigationMonitorManager.getStatus();
  }

  /**
   * Generate a unique event ID
   */
  private generateEventId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 10);
    return `event_${timestamp}_${random}`;
  }
}
