import type { 
  TelemetryCache as ITelemetryCache, 
  CacheEntry, 
  CacheConfig, 
  CacheStats 
} from '../types/StorageTypes';

/**
 * TelemetryCache - In-memory cache implementation
 * Phase 11: Storage & Caching Layer
 */
export class TelemetryCache implements ITelemetryCache {
  private cache = new Map<string, CacheEntry>();
  private config: CacheConfig;
  private stats: CacheStats;
  private cleanupTimer?: any;
  private isInitialized = false;

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = {
      maxSize: config.maxSize || 10 * 1024 * 1024, // 10MB default
      maxEntries: config.maxEntries || 1000,
      defaultTTL: config.defaultTTL || 30 * 60 * 1000, // 30 minutes
      cleanupInterval: config.cleanupInterval || 5 * 60 * 1000, // 5 minutes
      enableCompression: config.enableCompression || false,
      enablePersistence: config.enablePersistence || false,
      debugMode: config.debugMode || false
    };

    this.stats = {
      totalEntries: 0,
      totalSize: 0,
      hitCount: 0,
      missCount: 0,
      hitRate: 0,
      evictionCount: 0,
      averageEntrySize: 0
    };
  }

  /**
   * Initialize cache
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Start cleanup timer
      if (this.config.cleanupInterval > 0) {
        this.cleanupTimer = setInterval(() => {
          this.cleanup().catch(error => {
            if (this.config.debugMode) {
              console.warn('TelemetryCache: Cleanup error:', error);
            }
          });
        }, this.config.cleanupInterval);
      }

      this.isInitialized = true;

      if (this.config.debugMode) {
        console.log('TelemetryCache: Initialized with config:', this.config);
      }
    } catch (error) {
      if (this.config.debugMode) {
        console.error('TelemetryCache: Initialization failed:', error);
      }
      throw error;
    }
  }

  /**
   * Set cache entry
   */
  async set<T>(key: string, value: T, ttl?: number): Promise<boolean> {
    if (!this.isInitialized) {
      if (this.config.debugMode) {
        console.warn('TelemetryCache: Cache not initialized');
      }
      return false;
    }

    try {
      const now = Date.now();
      const effectiveTTL = ttl || this.config.defaultTTL;
      const expiresAt = effectiveTTL > 0 ? now + effectiveTTL : undefined;
      
      // Serialize value to calculate size
      const serializedValue = JSON.stringify(value);
      const entrySize = new Blob([serializedValue]).size;

      // Check if we need to evict entries
      await this.ensureCapacity(entrySize);

      // Create cache entry
      const entry: CacheEntry<T> = {
        key,
        value,
        timestamp: now,
        expiresAt,
        size: entrySize,
        accessCount: 0,
        lastAccessed: now
      };

      // Update existing entry or add new one
      const existingEntry = this.cache.get(key);
      if (existingEntry) {
        this.stats.totalSize -= existingEntry.size;
      } else {
        this.stats.totalEntries++;
      }

      this.cache.set(key, entry);
      this.stats.totalSize += entrySize;
      this.updateAverageEntrySize();

      if (this.config.debugMode) {
        console.log('TelemetryCache: Set entry:', key, 'size:', entrySize);
      }

      return true;
    } catch (error) {
      if (this.config.debugMode) {
        console.error('TelemetryCache: Failed to set entry:', key, error);
      }
      return false;
    }
  }

  /**
   * Get cache entry
   */
  async get<T>(key: string): Promise<T | null> {
    if (!this.isInitialized) {
      return null;
    }

    try {
      const entry = this.cache.get(key) as CacheEntry<T> | undefined;

      if (!entry) {
        this.stats.missCount++;
        this.updateHitRate();
        return null;
      }

      // Check if entry is expired
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        this.cache.delete(key);
        this.stats.totalEntries--;
        this.stats.totalSize -= entry.size;
        this.stats.missCount++;
        this.updateHitRate();
        this.updateAverageEntrySize();
        return null;
      }

      // Update access statistics
      entry.accessCount++;
      entry.lastAccessed = Date.now();
      this.stats.hitCount++;
      this.updateHitRate();

      if (this.config.debugMode) {
        console.log('TelemetryCache: Cache hit for key:', key);
      }

      return entry.value;
    } catch (error) {
      if (this.config.debugMode) {
        console.error('TelemetryCache: Failed to get entry:', key, error);
      }
      this.stats.missCount++;
      this.updateHitRate();
      return null;
    }
  }

  /**
   * Check if key exists
   */
  async has(key: string): Promise<boolean> {
    if (!this.isInitialized) {
      return false;
    }

    const entry = this.cache.get(key);
    
    if (!entry) {
      return false;
    }

    // Check if entry is expired
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.totalEntries--;
      this.stats.totalSize -= entry.size;
      this.updateAverageEntrySize();
      return false;
    }

    return true;
  }

  /**
   * Delete cache entry
   */
  async delete(key: string): Promise<boolean> {
    if (!this.isInitialized) {
      return false;
    }

    try {
      const entry = this.cache.get(key);
      
      if (!entry) {
        return false;
      }

      this.cache.delete(key);
      this.stats.totalEntries--;
      this.stats.totalSize -= entry.size;
      this.updateAverageEntrySize();

      if (this.config.debugMode) {
        console.log('TelemetryCache: Deleted entry:', key);
      }

      return true;
    } catch (error) {
      if (this.config.debugMode) {
        console.error('TelemetryCache: Failed to delete entry:', key, error);
      }
      return false;
    }
  }

  /**
   * Clear all cache entries
   */
  async clear(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    try {
      const entriesCleared = this.cache.size;
      this.cache.clear();
      
      this.stats.totalEntries = 0;
      this.stats.totalSize = 0;
      this.stats.averageEntrySize = 0;

      if (this.config.debugMode) {
        console.log('TelemetryCache: Cleared', entriesCleared, 'entries');
      }
    } catch (error) {
      if (this.config.debugMode) {
        console.error('TelemetryCache: Failed to clear cache:', error);
      }
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const entries = Array.from(this.cache.values());
    
    const oldestEntry = entries.length > 0 
      ? new Date(Math.min(...entries.map(e => e.timestamp)))
      : undefined;
    
    const newestEntry = entries.length > 0 
      ? new Date(Math.max(...entries.map(e => e.timestamp)))
      : undefined;

    return {
      ...this.stats,
      oldestEntry,
      newestEntry
    };
  }

  /**
   * Cleanup expired entries
   */
  async cleanup(): Promise<number> {
    if (!this.isInitialized) {
      return 0;
    }

    try {
      const now = Date.now();
      let expiredCount = 0;

      for (const [key, entry] of this.cache.entries()) {
        if (entry.expiresAt && now > entry.expiresAt) {
          this.cache.delete(key);
          this.stats.totalEntries--;
          this.stats.totalSize -= entry.size;
          expiredCount++;
        }
      }

      if (expiredCount > 0) {
        this.updateAverageEntrySize();
        
        if (this.config.debugMode) {
          console.log('TelemetryCache: Cleaned up', expiredCount, 'expired entries');
        }
      }

      return expiredCount;
    } catch (error) {
      if (this.config.debugMode) {
        console.error('TelemetryCache: Cleanup failed:', error);
      }
      return 0;
    }
  }

  /**
   * Get cache size in bytes
   */
  getSize(): number {
    return this.stats.totalSize;
  }

  /**
   * Dispose cache resources
   */
  async dispose(): Promise<void> {
    try {
      // Clear cleanup timer
      if (this.cleanupTimer) {
        clearInterval(this.cleanupTimer);
        this.cleanupTimer = undefined;
      }

      // Clear cache
      await this.clear();

      this.isInitialized = false;

      if (this.config.debugMode) {
        console.log('TelemetryCache: Disposed');
      }
    } catch (error) {
      if (this.config.debugMode) {
        console.error('TelemetryCache: Disposal failed:', error);
      }
    }
  }

  // Private helper methods

  private async ensureCapacity(newEntrySize: number): Promise<void> {
    // Check if we need to evict entries due to size limit
    while (this.stats.totalSize + newEntrySize > this.config.maxSize && this.cache.size > 0) {
      await this.evictLeastRecentlyUsed();
    }

    // Check if we need to evict entries due to entry count limit
    while (this.cache.size >= this.config.maxEntries) {
      await this.evictLeastRecentlyUsed();
    }
  }

  private async evictLeastRecentlyUsed(): Promise<void> {
    if (this.cache.size === 0) {
      return;
    }

    // Find least recently used entry
    let lruKey: string | null = null;
    let lruTime = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessed < lruTime) {
        lruTime = entry.lastAccessed;
        lruKey = key;
      }
    }

    if (lruKey) {
      const entry = this.cache.get(lruKey);
      if (entry) {
        this.cache.delete(lruKey);
        this.stats.totalEntries--;
        this.stats.totalSize -= entry.size;
        this.stats.evictionCount++;
        this.updateAverageEntrySize();

        if (this.config.debugMode) {
          console.log('TelemetryCache: Evicted LRU entry:', lruKey);
        }
      }
    }
  }

  private updateHitRate(): void {
    const totalRequests = this.stats.hitCount + this.stats.missCount;
    this.stats.hitRate = totalRequests > 0 ? this.stats.hitCount / totalRequests : 0;
  }

  private updateAverageEntrySize(): void {
    this.stats.averageEntrySize = this.stats.totalEntries > 0 
      ? this.stats.totalSize / this.stats.totalEntries 
      : 0;
  }
}
