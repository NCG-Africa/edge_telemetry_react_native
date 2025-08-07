/**
 * Storage and caching module exports
 * Phase 11: Storage & Caching Layer
 */

// Main storage manager
export { StorageManager } from './StorageManager';

// Storage providers
export { AsyncStorageProvider } from './providers/AsyncStorageProvider';

// Cache implementation
export { TelemetryCache } from './cache/TelemetryCache';

// Batching implementation
export { EventBatcher } from './batching/EventBatcher';

// Cleanup implementation
export { StorageCleanup } from './cleanup/StorageCleanup';

// Types and interfaces
export type {
  TelemetryStorage,
  TelemetryCache as ITelemetryCache,
  EventBatcher as IEventBatcher,
  StorageResult,
  StorageQueryOptions,
  StorageStats,
  CacheEntry,
  CacheConfig,
  CacheStats,
  EventBatch,
  BatchConfig,
  CleanupConfig,
  CleanupResult,
  StorageManagerConfig,
  StorageManagerStatus,
  NetworkSyncStatus,
  SyncResult
} from './types/StorageTypes';
