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
import type { NavigationContainerRef } from '@react-navigation/native';
import { ErrorMonitorManager } from './error/ErrorMonitorManager';
import type { ManualErrorOptions } from './error/types/ErrorTypes';
import { PerformanceMonitorManager } from './performance/PerformanceMonitorManager';
import type { ManualPerformanceOptions } from './performance/types/PerformanceTypes';
import { StorageManager } from './storage';
import type { StorageManagerConfig, EventBatch } from './storage';

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
  private errorMonitorManager?: ErrorMonitorManager;
  private performanceMonitorManager?: PerformanceMonitorManager;
  private storageManager?: StorageManager;
  
  // User profile management
  private currentUserProfile?: UserProfile;

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
        enableErrorReporting: initConfig.enableErrorReporting ?? DEFAULT_CONFIG.enableErrorReporting,
        enableStorageAndCaching: initConfig.enableStorageAndCaching ?? DEFAULT_CONFIG.enableStorageAndCaching,
      };

      instance.config = config;

      if (config.debugMode) {
        console.log('EdgeTelemetry: Initializing SDK with config:', config);
      }

      // 2. Initialize core managers (they are singletons that self-initialize)
      // Load any existing session data
      await instance.sessionManager.loadSession();
      
      // Get minimal device info for quick startup
      const deviceInfo = await instance.deviceInfoCollector.getMinimalDeviceInfo();
      
      // Start a new session if none exists
      if (!instance.sessionManager.getCurrentSession()) {
        await instance.sessionManager.startSession(deviceInfo, {
          'service.name': config.serviceName,
          'service.version': '2.0.0',
        });
        
        if (config.debugMode) {
          console.log('EdgeTelemetry: New session started');
        }
      }

      // 3. Initialize storage manager if enabled
      if (config.enableStorageAndCaching) {
        const storageConfig: StorageManagerConfig = {
          storageProvider: 'asyncstorage',
          cacheConfig: {
            maxSize: 10 * 1024 * 1024, // 10MB
            maxEntries: 1000,
            defaultTTL: 24 * 60 * 60 * 1000, // 24 hours
            cleanupInterval: 60 * 60 * 1000, // 1 hour
            enableCompression: false,
            enablePersistence: true,
            debugMode: config.debugMode,
          },
          batchConfig: {
            maxBatchSize: config.maxBatchSize,
            maxBatchSizeBytes: 1024 * 1024, // 1MB
            batchTimeout: config.batchTimeout,
            maxRetries: 3,
            retryBackoffMs: 1000,
            enableCompression: false,
            debugMode: config.debugMode,
          },
          cleanupConfig: {
            enabled: true,
            retentionDays: 7,
            maxStorageSize: 50 * 1024 * 1024, // 50MB
            cleanupInterval: 24 * 60 * 60 * 1000, // 24 hours
            batchSize: 100,
            debugMode: config.debugMode,
          },
          enableOfflineStorage: true,
          maxOfflineEvents: 10000,
          syncOnNetworkReconnect: true,
          debugMode: config.debugMode,
        };

        instance.storageManager = new StorageManager(storageConfig);
        await instance.storageManager.initialize();

        // Set up batch ready handler for network transmission
        instance.storageManager.setBatchReadyHandler(async (batch: EventBatch) => {
          await instance.handleBatchTransmission(batch);
        });

        if (config.debugMode) {
          console.log('EdgeTelemetry: Storage manager initialized');
        }
      }

      // 4. Initialize network monitoring if enabled
      if (config.enableNetworkMonitoring || config.enableHttpMonitoring) {
        instance.networkMonitorManager = new NetworkMonitorManager(config);
        
        // Initialize with telemetry event handler
        await instance.networkMonitorManager.initialize((events: TelemetryEvent[]) => {
          // Handle multiple events from network monitoring
          events.forEach(event => {
            instance.handleTelemetryEvent(event);
          });
        });

        if (config.debugMode) {
          console.log('EdgeTelemetry: Network monitoring initialized');
        }
      }

      // 5. Initialize navigation tracking if enabled
      if (config.enableNavigationTracking) {
        // NavigationMonitorManager expects callback as first parameter, config as second
        instance.navigationMonitorManager = new NavigationMonitorManager(
          (event: TelemetryEvent) => {
            instance.handleTelemetryEvent(event);
          },
          {
            enableAutomaticTracking: true,
            enableScreenDuration: true,
            enableRouteParams: true,
            ignoredRoutes: [],
            debugMode: config.debugMode,
          }
        );

        if (config.debugMode) {
          console.log('EdgeTelemetry: Navigation tracking initialized');
        }
      }

      // 6. Initialize error monitoring if enabled
      if (config.enableErrorReporting) {
        // ErrorMonitorManager expects callback as first parameter, config as second
        instance.errorMonitorManager = new ErrorMonitorManager(
          (event: TelemetryEvent) => {
            instance.handleTelemetryEvent(event);
          },
          {
            enableJavaScriptErrors: true,
            enablePromiseRejections: true,
            enableReactErrors: true,
            enableNativeErrors: false,
            captureStackTraces: true,
            maxStackTraceLength: 10000,
            debugMode: config.debugMode,
          }
        );
        
        // Initialize error monitoring
        instance.errorMonitorManager.initialize();

        if (config.debugMode) {
          console.log('EdgeTelemetry: Error monitoring initialized');
        }
      }

      // 7. Initialize performance monitoring if enabled
      if (config.enablePerformanceMonitoring) {
        // PerformanceMonitorManager expects callback as first parameter, config as second
        instance.performanceMonitorManager = new PerformanceMonitorManager(
          (event: TelemetryEvent) => {
            instance.handleTelemetryEvent(event);
          },
          {
            enableStartupMonitoring: true,
            enableMemoryMonitoring: true,
            enableBridgeMonitoring: true,
            enableBundleMonitoring: true,
            enableRenderMonitoring: false,
            enableNetworkMonitoring: false,
            memoryMonitoringInterval: 30000,
            bridgeMonitoringInterval: 10000,
            memoryWarningThreshold: 100,
            bridgeCallTimeThreshold: 100,
            renderTimeThreshold: 16,
            performanceSampleRate: 1.0,
            enablePerformanceTracing: true,
            debugMode: config.debugMode,
          }
        );
        
        // Initialize performance monitoring
        await instance.performanceMonitorManager.initialize();

        if (config.debugMode) {
          console.log('EdgeTelemetry: Performance monitoring initialized');
        }
      }

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
   * Track a custom event with attributes
   * Public API - Must match Flutter exactly
   */
  static async trackEvent(eventName: string, attributes?: any): Promise<void> {
    const instance = EdgeTelemetry.getInstance();
    if (!instance.initialized) {
      console.warn('EdgeTelemetry: SDK not initialized. Call initialize() first.');
      return;
    }

    try {
      const event = await instance.createTelemetryEvent(eventName, attributes);
      instance.handleTelemetryEvent(event);
    } catch (error) {
      if (instance.config?.debugMode) {
        console.error('EdgeTelemetry: Failed to track event:', error);
      }
    }
  }

  /**
   * Track a metric with numeric value
   * Public API - Must match Flutter exactly
   */
  static async trackMetric(metricName: string, value: number, attributes?: any): Promise<void> {
    const instance = EdgeTelemetry.getInstance();
    if (!instance.initialized) {
      console.warn('EdgeTelemetry: SDK not initialized. Call initialize() first.');
      return;
    }

    try {
      const metricAttributes = {
        ...attributes,
        'metric.name': metricName,
        'metric.value': value,
        'metric.type': 'gauge',
      };

      const event = await instance.createTelemetryEvent('metric.recorded', metricAttributes);
      instance.handleTelemetryEvent(event);
    } catch (error) {
      if (instance.config?.debugMode) {
        console.error('EdgeTelemetry: Failed to track metric:', error);
      }
    }
  }

  /**
   * Track an error or exception
   * Public API - Must match Flutter exactly
   */
  static async trackError(error: Error, stackTrace?: string, attributes?: Record<string, string>): Promise<void> {
    const instance = EdgeTelemetry.getInstance();
    if (!instance.initialized) {
      console.warn('EdgeTelemetry: SDK not initialized. Call initialize() first.');
      return;
    }

    if (instance.errorMonitorManager) {
      instance.errorMonitorManager.trackError(error, attributes);
    } else {
      // Fallback to manual error tracking
      try {
        const errorAttributes = {
          ...attributes,
          'error.type': error.name || 'Error',
          'error.message': error.message || 'Unknown error',
          'error.stack_trace': stackTrace || error.stack || '',
          'error.source': 'manual',
        };

        const event = await instance.createTelemetryEvent('error.occurred', errorAttributes);
        instance.handleTelemetryEvent(event);
      } catch (trackingError) {
        if (instance.config?.debugMode) {
          console.error('EdgeTelemetry: Failed to track error:', trackingError);
        }
      }
    }
  }

  /**
   * Set user profile information
   * Public API - Must match Flutter exactly
   */
  static async setUserProfile(profile: UserProfile): Promise<void> {
    const instance = EdgeTelemetry.getInstance();
    if (!instance.initialized) {
      console.warn('EdgeTelemetry: SDK not initialized. Call initialize() first.');
      return;
    }

    try {
      // Store user profile internally
      instance.currentUserProfile = {
        ...profile,
        updatedAt: new Date()
      };
      
      // Set the user ID in UserIdManager if provided
      if (profile.userId) {
        await instance.userIdManager.setCustomUserId(profile.userId);
      }
      
      if (instance.config?.debugMode) {
        console.log('EdgeTelemetry: User profile set:', profile);
      }
    } catch (error) {
      if (instance.config?.debugMode) {
        console.error('EdgeTelemetry: Failed to set user profile:', error);
      }
    }
  }

  /**
   * Clear user profile information
   * Public API - Must match Flutter exactly
   */
  static async clearUserProfile(): Promise<void> {
    const instance = EdgeTelemetry.getInstance();
    if (!instance.initialized) {
      console.warn('EdgeTelemetry: SDK not initialized. Call initialize() first.');
      return;
    }

    try {
      // Clear user profile internally
      instance.currentUserProfile = undefined;
      
      // Clear custom user ID from UserIdManager
      await instance.userIdManager.clearCustomUserId();
      
      if (instance.config?.debugMode) {
        console.log('EdgeTelemetry: User profile cleared');
      }
    } catch (error) {
      if (instance.config?.debugMode) {
        console.error('EdgeTelemetry: Failed to clear user profile:', error);
      }
    }
  }

  /**
   * Get current user ID
   * Public API - Must match Flutter exactly
   */
  static async currentUserId(): Promise<string | null> {
    const instance = EdgeTelemetry.getInstance();
    if (!instance.initialized) {
      return null;
    }

    try {
      return await instance.userIdManager.getUserId();
    } catch (error) {
      if (instance.config?.debugMode) {
        console.error('EdgeTelemetry: Failed to get current user ID:', error);
      }
      return null;
    }
  }

  /**
   * Get current user profile attributes
   * Public API - Must match Flutter exactly
   */
  static currentUserProfile(): Record<string, string> {
    const instance = EdgeTelemetry.getInstance();
    if (!instance.initialized) {
      return {};
    }

    try {
      // Return user profile attributes from internal storage
      if (instance.currentUserProfile) {
        return {
          userId: instance.currentUserProfile.userId,
          email: instance.currentUserProfile.email || '',
          name: instance.currentUserProfile.name || '',
          ...instance.currentUserProfile.attributes,
          updatedAt: instance.currentUserProfile.updatedAt.toISOString(),
        };
      }
      return {};
    } catch (error) {
      if (instance.config?.debugMode) {
        console.error('EdgeTelemetry: Failed to get current user profile:', error);
      }
      return {};
    }
  }

  /**
   * Get current session information
   * Public API - Must match Flutter exactly
   */
  static currentSessionInfo(): Record<string, any> {
    const instance = EdgeTelemetry.getInstance();
    if (!instance.initialized) {
      return {};
    }

    try {
      // Use the existing getCurrentSessionInfo method from SessionManager
      return instance.sessionManager.getCurrentSessionInfo();
    } catch (error) {
      if (instance.config?.debugMode) {
        console.error('EdgeTelemetry: Failed to get session info:', error);
      }
      return {};
    }
  }

  /**
   * Dispose of the SDK and clean up resources
   * Public API - Must match Flutter exactly
   */
  static async dispose(): Promise<void> {
    const instance = EdgeTelemetry.getInstance();
    
    try {
      // Dispose of all managers (note: NetworkMonitorManager uses shutdown())
      if (instance.storageManager) {
        await instance.storageManager.dispose();
      }
      if (instance.networkMonitorManager) {
        instance.networkMonitorManager.shutdown();
      }
      if (instance.navigationMonitorManager) {
        instance.navigationMonitorManager.dispose();
      }
      if (instance.errorMonitorManager) {
        instance.errorMonitorManager.dispose();
      }
      if (instance.performanceMonitorManager) {
        instance.performanceMonitorManager.dispose();
      }

      // Log before clearing config
      const debugMode = instance.config?.debugMode;
      
      // Reset state
      instance.initialized = false;
      instance.config = undefined;
      instance.storageManager = undefined;
      instance.networkMonitorManager = undefined;
      instance.navigationMonitorManager = undefined;
      instance.errorMonitorManager = undefined;
      instance.performanceMonitorManager = undefined;

      if (debugMode) {
        console.log('EdgeTelemetry: SDK disposed');
      }
    } catch (error) {
      console.error('EdgeTelemetry: Error during disposal:', error);
    }
  }

  // =============================================================================
  // NAVIGATION TRACKING METHODS
  // =============================================================================

  /**
   * Initialize navigation tracking with React Navigation container ref
   */
  static initializeNavigationTracking(navigationRef: NavigationContainerRef<any>): void {
    const instance = EdgeTelemetry.getInstance();
    if (!instance.navigationMonitorManager) {
      if (instance.config?.debugMode) {
        console.warn('EdgeTelemetry: Navigation monitoring not initialized');
      }
      return;
    }
    instance.navigationMonitorManager.initializeReactNavigation(navigationRef);
  }

  /**
   * Get current screen name
   */
  static getCurrentScreen(): string | null {
    const instance = EdgeTelemetry.getInstance();
    if (!instance.navigationMonitorManager) {
      return null;
    }
    return instance.navigationMonitorManager.getCurrentScreen();
  }

  // =============================================================================
  // ERROR TRACKING METHODS
  // =============================================================================

  /**
   * Track a manual error with options
   */
  static trackManualError(options: ManualErrorOptions): void {
    const instance = EdgeTelemetry.getInstance();
    if (!instance.errorMonitorManager) {
      if (instance.config?.debugMode) {
        console.warn('EdgeTelemetry: Error monitoring not initialized');
      }
      return;
    }
    instance.errorMonitorManager.trackManualError(options);
  }

  /**
   * Get error statistics
   */
  static getErrorStats(): Record<string, number> {
    const instance = EdgeTelemetry.getInstance();
    if (!instance.errorMonitorManager) {
      return {};
    }
    return instance.errorMonitorManager.getErrorStats();
  }

  // =============================================================================
  // PERFORMANCE MONITORING METHODS
  // =============================================================================

  /**
   * Track a manual performance metric
   */
  static trackPerformance(options: ManualPerformanceOptions): void {
    const instance = EdgeTelemetry.getInstance();
    if (!instance.performanceMonitorManager) {
      if (instance.config?.debugMode) {
        console.warn('EdgeTelemetry: Performance monitoring not initialized');
      }
      return;
    }
    instance.performanceMonitorManager.trackManualPerformance(options);
  }

  /**
   * Get comprehensive performance metrics
   */
  static getPerformanceMetrics(): Record<string, any> {
    const instance = EdgeTelemetry.getInstance();
    if (!instance.performanceMonitorManager) {
      return {};
    }
    return instance.performanceMonitorManager.getPerformanceMetrics();
  }

  // =============================================================================
  // STORAGE AND CACHING METHODS
  // =============================================================================

  /**
   * Force sync of cached events to storage and network
   */
  static async forceSync(): Promise<void> {
    const instance = EdgeTelemetry.getInstance();
    if (!instance.storageManager) {
      if (instance.config?.debugMode) {
        console.warn('EdgeTelemetry: Storage manager not initialized');
      }
      return;
    }

    try {
      await instance.storageManager.forceSync();
      if (instance.config?.debugMode) {
        console.log('EdgeTelemetry: Force sync completed');
      }
    } catch (error) {
      if (instance.config?.debugMode) {
        console.error('EdgeTelemetry: Force sync failed:', error);
      }
    }
  }

  /**
   * Clear all cached and stored telemetry data
   */
  static async clearStoredData(): Promise<void> {
    const instance = EdgeTelemetry.getInstance();
    if (!instance.storageManager) {
      if (instance.config?.debugMode) {
        console.warn('EdgeTelemetry: Storage manager not initialized');
      }
      return;
    }

    try {
      await instance.storageManager.clearAllData();
      if (instance.config?.debugMode) {
        console.log('EdgeTelemetry: All stored data cleared');
      }
    } catch (error) {
      if (instance.config?.debugMode) {
        console.error('EdgeTelemetry: Failed to clear stored data:', error);
      }
    }
  }

  /**
   * Get storage statistics
   */
  static getStorageStats(): Record<string, any> {
    const instance = EdgeTelemetry.getInstance();
    if (!instance.storageManager) {
      return {};
    }
    return instance.storageManager.getStatus();
  }

  // =============================================================================
  // PRIVATE METHODS
  // =============================================================================

  /**
   * Create a telemetry event with standard attributes
   */
  private async createTelemetryEvent(eventName: string, attributes?: any): Promise<TelemetryEvent> {
    const sessionId = this.sessionManager.getCurrentSessionId() || 'unknown';
    const userId = await this.userIdManager.getUserId();

    // Convert and sanitize attributes
    const eventAttributes = AttributeConverter.convertToStringMap(attributes || {});
    
    // Add global attributes
    const standardAttributes = {
      ...eventAttributes,
      ...this.config?.globalAttributes,
      sessionId,
      userId,
    };

    return {
      id: this.generateEventId(),
      sessionId,
      eventName,
      timestamp: new Date(),
      attributes: AttributeConverter.convertToStringMap(standardAttributes),
      userId,
    };
  }

  /**
   * Handle telemetry event (store or queue)
   */
  private handleTelemetryEvent(event: TelemetryEvent): void {
    if (this.storageManager) {
      // Store event using storage manager
      this.storageManager.storeEvent(event).catch((error) => {
        if (this.config?.debugMode) {
          console.error('EdgeTelemetry: Failed to store event:', error);
        }
      });
    } else {
      // Fallback: send directly to network (placeholder)
      this.sendEventToNetwork(event).catch((error) => {
        if (this.config?.debugMode) {
          console.error('EdgeTelemetry: Failed to send event to network:', error);
        }
      });
    }
  }

  /**
   * Handle batch transmission to network
   */
  private async handleBatchTransmission(batch: EventBatch): Promise<void> {
    try {
      if (this.config?.debugMode) {
        console.log(`EdgeTelemetry: Transmitting batch with ${batch.events.length} events`);
      }

      // TODO: Implement actual network transmission
      // For now, just log the batch
      await this.sendBatchToNetwork(batch);

      if (this.config?.debugMode) {
        console.log('EdgeTelemetry: Batch transmission successful');
      }
    } catch (error) {
      if (this.config?.debugMode) {
        console.error('EdgeTelemetry: Batch transmission failed:', error);
      }
      throw error;
    }
  }

  /**
   * Send single event to network (placeholder)
   */
  private async sendEventToNetwork(event: TelemetryEvent): Promise<void> {
    // TODO: Implement actual network sending
    if (this.config?.debugMode) {
      console.log('EdgeTelemetry: Sending event to network:', event);
    }
  }

  /**
   * Send batch to network (placeholder)
   */
  private async sendBatchToNetwork(batch: EventBatch): Promise<void> {
    // TODO: Implement actual batch network sending
    if (this.config?.debugMode) {
      console.log('EdgeTelemetry: Sending batch to network:', {
        batchId: batch.id,
        eventCount: batch.events.length,
        size: batch.size,
      });
    }
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
