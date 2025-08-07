import NetInfo from '@react-native-community/netinfo';
import type { NetInfoState } from '@react-native-community/netinfo';
import type { TelemetryEvent } from '../core/models/TelemetryEvent';
import type { 
  TelemetryStorage,
  TelemetryCache,
  EventBatcher,
  StorageManagerConfig,
  StorageManagerStatus,
  NetworkSyncStatus,
  SyncResult,
  StorageResult
} from './types/StorageTypes';
import { AsyncStorageProvider } from './providers/AsyncStorageProvider';
import { TelemetryCache as TelemetryCacheImpl } from './cache/TelemetryCache';
import { EventBatcher as EventBatcherImpl } from './batching/EventBatcher';
import { StorageCleanup } from './cleanup/StorageCleanup';

/**
 * StorageManager - Main coordinator for storage, caching, and batching
 * Phase 11: Storage & Caching Layer
 */
export class StorageManager {
  private config: StorageManagerConfig;
  private storage?: TelemetryStorage;
  private cache?: TelemetryCache;
  private batcher?: EventBatcher;
  private cleanup?: StorageCleanup;
  private isInitialized = false;
  private networkStatus: NetworkSyncStatus = 'offline';
  private netInfoUnsubscribe?: (() => void) | null;
  private syncInProgress = false;
  private lastSyncTime?: Date;

  // Event handlers
  private onBatchReadyHandler?: (batch: any) => Promise<void>;
  private onSyncCompleteHandler?: (result: SyncResult) => void;

  constructor(config: Partial<StorageManagerConfig> = {}) {
    this.config = {
      storageProvider: config.storageProvider || 'asyncstorage',
      cacheConfig: {
        maxSize: 10 * 1024 * 1024, // 10MB
        maxEntries: 1000,
        defaultTTL: 30 * 60 * 1000, // 30 minutes
        cleanupInterval: 5 * 60 * 1000, // 5 minutes
        enableCompression: false,
        enablePersistence: false,
        debugMode: false,
        ...config.cacheConfig
      },
      batchConfig: {
        maxBatchSize: 30,
        maxBatchSizeBytes: 1024 * 1024, // 1MB
        batchTimeout: 30000, // 30 seconds
        maxRetries: 3,
        retryBackoffMs: 5000, // 5 seconds
        enableCompression: false,
        debugMode: false,
        ...config.batchConfig
      },
      cleanupConfig: {
        enabled: true,
        retentionDays: 30,
        maxStorageSize: 50 * 1024 * 1024, // 50MB
        cleanupInterval: 24 * 60 * 60 * 1000, // 24 hours
        batchSize: 100,
        debugMode: false,
        ...config.cleanupConfig
      },
      enableOfflineStorage: config.enableOfflineStorage !== false, // Default true
      maxOfflineEvents: config.maxOfflineEvents || 10000,
      syncOnNetworkReconnect: config.syncOnNetworkReconnect !== false, // Default true
      debugMode: config.debugMode || false
    };
  }

  /**
   * Initialize storage manager
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      if (this.config.debugMode) {
        console.log('StorageManager: Initializing with config:', this.config);
      }

      // Initialize storage provider
      await this.initializeStorage();

      // Initialize cache
      await this.initializeCache();

      // Initialize batcher
      await this.initializeBatcher();

      // Initialize cleanup
      await this.initializeCleanup();

      // Initialize network monitoring
      await this.initializeNetworkMonitoring();

      this.isInitialized = true;

      if (this.config.debugMode) {
        console.log('StorageManager: Initialization completed');
      }
    } catch (error) {
      if (this.config.debugMode) {
        console.error('StorageManager: Initialization failed:', error);
      }
      throw error;
    }
  }

  /**
   * Store telemetry event
   */
  async storeEvent(event: TelemetryEvent): Promise<void> {
    if (!this.isInitialized || !this.storage) {
      if (this.config.debugMode) {
        console.warn('StorageManager: Not initialized, dropping event');
      }
      return;
    }

    try {
      // Store in persistent storage if offline storage is enabled
      if (this.config.enableOfflineStorage) {
        const result = await this.storage.storeEvent(event);
        if (!result.success && this.config.debugMode) {
          console.warn('StorageManager: Failed to store event in persistent storage:', result.error);
        }
      }

      // Add to batch for network transmission
      if (this.batcher) {
        await this.batcher.addEvent(event);
      }

      // Cache frequently accessed data
      if (this.cache) {
        const cacheKey = `event_${event.id}`;
        await this.cache.set(cacheKey, event);
      }

      if (this.config.debugMode) {
        console.log('StorageManager: Event stored and queued:', event.id);
      }
    } catch (error) {
      if (this.config.debugMode) {
        console.error('StorageManager: Failed to store event:', error);
      }
    }
  }

  /**
   * Store multiple telemetry events
   */
  async storeEvents(events: TelemetryEvent[]): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    try {
      // Store in persistent storage
      if (this.config.enableOfflineStorage && this.storage) {
        const result = await this.storage.storeEvents(events);
        if (!result.success && this.config.debugMode) {
          console.warn('StorageManager: Failed to store events in persistent storage:', result.error);
        }
      }

      // Add to batch
      if (this.batcher) {
        await this.batcher.addEvents(events);
      }

      // Cache events
      if (this.cache) {
        for (const event of events) {
          const cacheKey = `event_${event.id}`;
          await this.cache.set(cacheKey, event);
        }
      }

      if (this.config.debugMode) {
        console.log('StorageManager: Stored and queued', events.length, 'events');
      }
    } catch (error) {
      if (this.config.debugMode) {
        console.error('StorageManager: Failed to store events:', error);
      }
    }
  }

  /**
   * Get cached event
   */
  async getCachedEvent(eventId: string): Promise<TelemetryEvent | null> {
    if (!this.cache) {
      return null;
    }

    try {
      const cacheKey = `event_${eventId}`;
      return await this.cache.get<TelemetryEvent>(cacheKey);
    } catch (error) {
      if (this.config.debugMode) {
        console.warn('StorageManager: Failed to get cached event:', error);
      }
      return null;
    }
  }

  /**
   * Get stored events
   */
  async getStoredEvents(options?: any): Promise<TelemetryEvent[]> {
    if (!this.storage) {
      return [];
    }

    try {
      const result = await this.storage.getEvents(options);
      return result.success && result.data ? result.data : [];
    } catch (error) {
      if (this.config.debugMode) {
        console.error('StorageManager: Failed to get stored events:', error);
      }
      return [];
    }
  }

  /**
   * Force sync with network
   */
  async forceSync(): Promise<SyncResult> {
    if (this.syncInProgress) {
      return {
        success: false,
        eventsSynced: 0,
        batchesSynced: 0,
        errors: ['Sync already in progress'],
        duration: 0,
        networkStatus: this.networkStatus
      };
    }

    return await this.performSync();
  }

  /**
   * Set batch ready handler
   */
  setBatchReadyHandler(handler: (batch: any) => Promise<void>): void {
    this.onBatchReadyHandler = handler;
  }

  /**
   * Set sync complete handler
   */
  setSyncCompleteHandler(handler: (result: SyncResult) => void): void {
    this.onSyncCompleteHandler = handler;
  }

  /**
   * Get storage manager status
   */
  async getStatus(): Promise<StorageManagerStatus> {
    const storageStats = this.storage ? await this.storage.getStats() : null;
    const cacheStats = this.cache ? this.cache.getStats() : null;
    const batchingStats = this.batcher ? this.batcher.getStats() : null;

    return {
      initialized: this.isInitialized,
      storageProvider: this.config.storageProvider,
      storageAvailable: this.storage ? await this.storage.isAvailable() : false,
      cacheEnabled: !!this.cache,
      batchingEnabled: !!this.batcher,
      cleanupEnabled: !!this.cleanup,
      offlineMode: this.networkStatus === 'offline',
      stats: {
        storage: storageStats?.data || {
          totalEvents: 0,
          totalSize: 0,
          eventsByType: {},
          storageUsage: 0
        },
        cache: cacheStats || {
          totalEntries: 0,
          totalSize: 0,
          hitCount: 0,
          missCount: 0,
          hitRate: 0,
          evictionCount: 0,
          averageEntrySize: 0
        },
        batching: batchingStats || {
          pendingBatches: 0,
          totalEvents: 0,
          completedBatches: 0,
          failedBatches: 0
        }
      },
      lastSync: this.lastSyncTime,
      config: this.config
    };
  }

  /**
   * Update configuration
   */
  async updateConfig(newConfig: Partial<StorageManagerConfig>): Promise<void> {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...newConfig };

    try {
      // Update cleanup configuration
      if (this.cleanup && newConfig.cleanupConfig) {
        this.cleanup.updateConfig(newConfig.cleanupConfig);
      }

      if (this.config.debugMode) {
        console.log('StorageManager: Configuration updated');
      }
    } catch (error) {
      if (this.config.debugMode) {
        console.error('StorageManager: Failed to update configuration:', error);
      }
    }
  }

  /**
   * Clear all stored data
   */
  async clearAllData(): Promise<void> {
    try {
      // Clear storage
      if (this.storage) {
        await this.storage.clearAllEvents();
      }

      // Clear cache
      if (this.cache) {
        await this.cache.clear();
      }

      // Clear pending batches (this is more complex, would need batcher support)
      // For now, we'll let them complete naturally

      if (this.config.debugMode) {
        console.log('StorageManager: All data cleared');
      }
    } catch (error) {
      if (this.config.debugMode) {
        console.error('StorageManager: Failed to clear data:', error);
      }
    }
  }

  /**
   * Dispose storage manager
   */
  async dispose(): Promise<void> {
    try {
      // Dispose network monitoring
      if (this.netInfoUnsubscribe) {
        this.netInfoUnsubscribe();
        this.netInfoUnsubscribe = null;
      }

      // Dispose cleanup
      if (this.cleanup) {
        await this.cleanup.dispose();
      }

      // Dispose batcher
      if (this.batcher) {
        await this.batcher.dispose();
      }

      // Dispose cache
      if (this.cache) {
        await this.cache.dispose();
      }

      // Dispose storage
      if (this.storage) {
        await this.storage.dispose();
      }

      this.isInitialized = false;

      if (this.config.debugMode) {
        console.log('StorageManager: Disposed');
      }
    } catch (error) {
      if (this.config.debugMode) {
        console.error('StorageManager: Disposal failed:', error);
      }
    }
  }

  // Private helper methods

  private async initializeStorage(): Promise<void> {
    switch (this.config.storageProvider) {
      case 'asyncstorage':
        this.storage = new AsyncStorageProvider(this.config.debugMode);
        break;
      case 'sqlite':
        // TODO: Implement SQLiteStorageProvider
        throw new Error('SQLite storage provider not yet implemented');
      case 'memory':
        // TODO: Implement MemoryStorageProvider
        throw new Error('Memory storage provider not yet implemented');
      default:
        throw new Error(`Unknown storage provider: ${this.config.storageProvider}`);
    }

    const result = await this.storage.initialize();
    if (!result.success) {
      throw new Error(`Storage initialization failed: ${result.error}`);
    }
  }

  private async initializeCache(): Promise<void> {
    this.cache = new TelemetryCacheImpl(this.config.cacheConfig);
    await this.cache.initialize();
  }

  private async initializeBatcher(): Promise<void> {
    this.batcher = new EventBatcherImpl(this.config.batchConfig);
    await this.batcher.initialize();

    // Set up batch processing
    this.startBatchProcessing();
  }

  private async initializeCleanup(): Promise<void> {
    if (this.storage && this.config.cleanupConfig.enabled) {
      this.cleanup = new StorageCleanup(this.storage, this.config.cleanupConfig);
      await this.cleanup.initialize();
    }
  }

  private async initializeNetworkMonitoring(): Promise<void> {
    try {
      // Get initial network state
      const netInfo = await NetInfo.fetch();
      this.updateNetworkStatus(netInfo);

      // Subscribe to network changes
      this.netInfoUnsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
        this.updateNetworkStatus(state);
      });

      if (this.config.debugMode) {
        console.log('StorageManager: Network monitoring initialized, status:', this.networkStatus);
      }
    } catch (error) {
      if (this.config.debugMode) {
        console.warn('StorageManager: Network monitoring initialization failed:', error);
      }
      // Continue without network monitoring
    }
  }

  private updateNetworkStatus(netInfo: NetInfoState): void {
    const wasOffline = this.networkStatus === 'offline';
    
    if (netInfo.isConnected && netInfo.isInternetReachable) {
      this.networkStatus = 'online';
    } else {
      this.networkStatus = 'offline';
    }

    if (this.config.debugMode) {
      console.log('StorageManager: Network status changed to:', this.networkStatus);
    }

    // Trigger sync on reconnection
    if (wasOffline && this.networkStatus === 'online' && this.config.syncOnNetworkReconnect) {
      this.performSync().catch(error => {
        if (this.config.debugMode) {
          console.error('StorageManager: Auto-sync on reconnection failed:', error);
        }
      });
    }
  }

  private startBatchProcessing(): void {
    // Check for ready batches periodically
    const processBatches = async () => {
      try {
        if (!this.batcher) return;

        const pendingBatches = await this.batcher.getPendingBatches();
        
        for (const batch of pendingBatches) {
          if (this.onBatchReadyHandler) {
            try {
              await this.onBatchReadyHandler(batch);
              await this.batcher.markBatchCompleted(batch.id);
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : 'Unknown error';
              await this.batcher.markBatchFailed(batch.id, errorMessage);
            }
          }
        }
      } catch (error) {
        if (this.config.debugMode) {
          console.error('StorageManager: Batch processing error:', error);
        }
      }
    };

    // Process batches every 10 seconds
    setInterval(processBatches, 10000);
  }

  private async performSync(): Promise<SyncResult> {
    if (this.syncInProgress) {
      return {
        success: false,
        eventsSynced: 0,
        batchesSynced: 0,
        errors: ['Sync already in progress'],
        duration: 0,
        networkStatus: this.networkStatus
      };
    }

    this.syncInProgress = true;
    const startTime = Date.now();
    const result: SyncResult = {
      success: true,
      eventsSynced: 0,
      batchesSynced: 0,
      errors: [],
      duration: 0,
      networkStatus: this.networkStatus
    };

    try {
      if (this.networkStatus !== 'online') {
        result.success = false;
        result.errors.push('Network not available');
        return result;
      }

      this.networkStatus = 'syncing';

      // Get pending batches
      if (this.batcher) {
        const pendingBatches = await this.batcher.getPendingBatches();
        
        for (const batch of pendingBatches) {
          try {
            if (this.onBatchReadyHandler) {
              await this.onBatchReadyHandler(batch);
              await this.batcher.markBatchCompleted(batch.id);
              result.batchesSynced++;
              result.eventsSynced += batch.events.length;
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            result.errors.push(`Batch ${batch.id} failed: ${errorMessage}`);
            await this.batcher.markBatchFailed(batch.id, errorMessage);
          }
        }
      }

      this.lastSyncTime = new Date();
      this.networkStatus = 'online';

      if (this.config.debugMode) {
        console.log('StorageManager: Sync completed:', result);
      }

      // Notify sync completion
      if (this.onSyncCompleteHandler) {
        this.onSyncCompleteHandler(result);
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      result.success = false;
      result.errors.push(`Sync failed: ${errorMessage}`);
      this.networkStatus = 'error';

      if (this.config.debugMode) {
        console.error('StorageManager: Sync failed:', error);
      }

      return result;
    } finally {
      result.duration = Date.now() - startTime;
      this.syncInProgress = false;
    }
  }
}
