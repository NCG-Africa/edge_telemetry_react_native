/**
 * Storage and caching types matching Flutter SDK
 * Phase 11: Storage & Caching Layer
 */

import type { TelemetryEvent } from '../../core/models/TelemetryEvent';

/**
 * Storage operation result
 */
export interface StorageResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp?: number;
}

/**
 * Storage query options
 */
export interface StorageQueryOptions {
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDirection?: 'asc' | 'desc';
  filters?: Record<string, any>;
  startDate?: Date;
  endDate?: Date;
}

/**
 * Storage statistics
 */
export interface StorageStats {
  totalEvents: number;
  totalSize: number; // bytes
  oldestEvent?: Date;
  newestEvent?: Date;
  eventsByType: Record<string, number>;
  storageUsage: number; // percentage
  lastCleanup?: Date;
}

/**
 * Telemetry storage interface matching Flutter contract
 */
export interface TelemetryStorage {
  /**
   * Initialize storage
   */
  initialize(): Promise<StorageResult<void>>;

  /**
   * Store single telemetry event
   */
  storeEvent(event: TelemetryEvent): Promise<StorageResult<string>>;

  /**
   * Store multiple telemetry events
   */
  storeEvents(events: TelemetryEvent[]): Promise<StorageResult<string[]>>;

  /**
   * Retrieve events by query
   */
  getEvents(options?: StorageQueryOptions): Promise<StorageResult<TelemetryEvent[]>>;

  /**
   * Get event by ID
   */
  getEvent(id: string): Promise<StorageResult<TelemetryEvent>>;

  /**
   * Delete event by ID
   */
  deleteEvent(id: string): Promise<StorageResult<void>>;

  /**
   * Delete multiple events by IDs
   */
  deleteEvents(ids: string[]): Promise<StorageResult<void>>;

  /**
   * Delete events by query
   */
  deleteEventsByQuery(options: StorageQueryOptions): Promise<StorageResult<number>>;

  /**
   * Clear all events
   */
  clearAllEvents(): Promise<StorageResult<void>>;

  /**
   * Get storage statistics
   */
  getStats(): Promise<StorageResult<StorageStats>>;

  /**
   * Cleanup old events based on retention policy
   */
  cleanup(retentionDays: number): Promise<StorageResult<number>>;

  /**
   * Check if storage is available
   */
  isAvailable(): Promise<boolean>;

  /**
   * Get storage size in bytes
   */
  getSize(): Promise<number>;

  /**
   * Dispose storage resources
   */
  dispose(): Promise<void>;
}

/**
 * Cache entry
 */
export interface CacheEntry<T = any> {
  key: string;
  value: T;
  timestamp: number;
  expiresAt?: number;
  size: number;
  accessCount: number;
  lastAccessed: number;
}

/**
 * Cache configuration
 */
export interface CacheConfig {
  maxSize: number; // bytes
  maxEntries: number;
  defaultTTL: number; // milliseconds
  cleanupInterval: number; // milliseconds
  enableCompression: boolean;
  enablePersistence: boolean;
  debugMode: boolean;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  totalEntries: number;
  totalSize: number; // bytes
  hitCount: number;
  missCount: number;
  hitRate: number;
  evictionCount: number;
  oldestEntry?: Date;
  newestEntry?: Date;
  averageEntrySize: number;
}

/**
 * Telemetry cache interface
 */
export interface TelemetryCache {
  /**
   * Initialize cache
   */
  initialize(): Promise<void>;

  /**
   * Set cache entry
   */
  set<T>(key: string, value: T, ttl?: number): Promise<boolean>;

  /**
   * Get cache entry
   */
  get<T>(key: string): Promise<T | null>;

  /**
   * Check if key exists
   */
  has(key: string): Promise<boolean>;

  /**
   * Delete cache entry
   */
  delete(key: string): Promise<boolean>;

  /**
   * Clear all cache entries
   */
  clear(): Promise<void>;

  /**
   * Get cache statistics
   */
  getStats(): CacheStats;

  /**
   * Cleanup expired entries
   */
  cleanup(): Promise<number>;

  /**
   * Get cache size in bytes
   */
  getSize(): number;

  /**
   * Dispose cache resources
   */
  dispose(): Promise<void>;
}

/**
 * Event batch for processing
 */
export interface EventBatch {
  id: string;
  events: TelemetryEvent[];
  createdAt: Date;
  size: number; // bytes
  retryCount: number;
  maxRetries: number;
  nextRetryAt?: Date;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

/**
 * Batch configuration
 */
export interface BatchConfig {
  maxBatchSize: number; // number of events
  maxBatchSizeBytes: number; // bytes
  batchTimeout: number; // milliseconds
  maxRetries: number;
  retryBackoffMs: number;
  enableCompression: boolean;
  debugMode: boolean;
}

/**
 * Event batcher interface
 */
export interface EventBatcher {
  /**
   * Initialize batcher
   */
  initialize(): Promise<void>;

  /**
   * Add event to batch
   */
  addEvent(event: TelemetryEvent): Promise<void>;

  /**
   * Add multiple events to batch
   */
  addEvents(events: TelemetryEvent[]): Promise<void>;

  /**
   * Force flush current batch
   */
  flush(): Promise<EventBatch[]>;

  /**
   * Get pending batches
   */
  getPendingBatches(): Promise<EventBatch[]>;

  /**
   * Mark batch as completed
   */
  markBatchCompleted(batchId: string): Promise<void>;

  /**
   * Mark batch as failed
   */
  markBatchFailed(batchId: string, error: string): Promise<void>;

  /**
   * Retry failed batches
   */
  retryFailedBatches(): Promise<EventBatch[]>;

  /**
   * Get batcher statistics
   */
  getStats(): {
    pendingBatches: number;
    totalEvents: number;
    completedBatches: number;
    failedBatches: number;
  };

  /**
   * Dispose batcher resources
   */
  dispose(): Promise<void>;
}

/**
 * Storage cleanup configuration
 */
export interface CleanupConfig {
  enabled: boolean;
  retentionDays: number;
  maxStorageSize: number; // bytes
  cleanupInterval: number; // milliseconds
  batchSize: number; // events to delete per batch
  debugMode: boolean;
}

/**
 * Storage cleanup result
 */
export interface CleanupResult {
  eventsDeleted: number;
  bytesFreed: number;
  duration: number; // milliseconds
  errors: string[];
}

/**
 * Storage manager configuration
 */
export interface StorageManagerConfig {
  // Storage provider
  storageProvider: 'asyncstorage' | 'sqlite' | 'memory';
  
  // Cache configuration
  cacheConfig: Partial<CacheConfig>;
  
  // Batch configuration
  batchConfig: Partial<BatchConfig>;
  
  // Cleanup configuration
  cleanupConfig: Partial<CleanupConfig>;
  
  // Network configuration
  enableOfflineStorage: boolean;
  maxOfflineEvents: number;
  syncOnNetworkReconnect: boolean;
  
  // Debug
  debugMode: boolean;
}

/**
 * Storage manager status
 */
export interface StorageManagerStatus {
  initialized: boolean;
  storageProvider: string;
  storageAvailable: boolean;
  cacheEnabled: boolean;
  batchingEnabled: boolean;
  cleanupEnabled: boolean;
  offlineMode: boolean;
  stats: {
    storage: StorageStats;
    cache: CacheStats;
    batching: {
      pendingBatches: number;
      totalEvents: number;
      completedBatches: number;
      failedBatches: number;
    };
  };
  lastSync?: Date;
  config: StorageManagerConfig;
}

/**
 * Network sync status
 */
export type NetworkSyncStatus = 'online' | 'offline' | 'syncing' | 'error';

/**
 * Sync result
 */
export interface SyncResult {
  success: boolean;
  eventsSynced: number;
  batchesSynced: number;
  errors: string[];
  duration: number; // milliseconds
  networkStatus: NetworkSyncStatus;
}
