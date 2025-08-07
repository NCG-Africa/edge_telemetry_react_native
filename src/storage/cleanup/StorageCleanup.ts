import type { TelemetryStorage } from '../types/StorageTypes';
import type { 
  CleanupConfig, 
  CleanupResult, 
  StorageQueryOptions 
} from '../types/StorageTypes';

/**
 * StorageCleanup - Manages storage cleanup and retention policies
 * Phase 11: Storage & Caching Layer
 */
export class StorageCleanup {
  private config: CleanupConfig;
  private storage: TelemetryStorage;
  private cleanupTimer?: any;
  private isRunning = false;

  constructor(storage: TelemetryStorage, config: Partial<CleanupConfig> = {}) {
    this.storage = storage;
    this.config = {
      enabled: config.enabled !== false, // Default to true
      retentionDays: config.retentionDays || 30,
      maxStorageSize: config.maxStorageSize || 50 * 1024 * 1024, // 50MB
      cleanupInterval: config.cleanupInterval || 24 * 60 * 60 * 1000, // 24 hours
      batchSize: config.batchSize || 100,
      debugMode: config.debugMode || false
    };
  }

  /**
   * Initialize storage cleanup
   */
  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      if (this.config.debugMode) {
        console.log('StorageCleanup: Cleanup disabled');
      }
      return;
    }

    try {
      // Start cleanup timer
      if (this.config.cleanupInterval > 0) {
        this.cleanupTimer = setInterval(() => {
          this.performCleanup().catch(error => {
            if (this.config.debugMode) {
              console.error('StorageCleanup: Scheduled cleanup failed:', error);
            }
          });
        }, this.config.cleanupInterval);
      }

      // Perform initial cleanup
      await this.performCleanup();

      if (this.config.debugMode) {
        console.log('StorageCleanup: Initialized with config:', this.config);
      }
    } catch (error) {
      if (this.config.debugMode) {
        console.error('StorageCleanup: Initialization failed:', error);
      }
      throw error;
    }
  }

  /**
   * Perform cleanup operation
   */
  async performCleanup(): Promise<CleanupResult> {
    if (this.isRunning) {
      if (this.config.debugMode) {
        console.log('StorageCleanup: Cleanup already running, skipping');
      }
      return {
        eventsDeleted: 0,
        bytesFreed: 0,
        duration: 0,
        errors: []
      };
    }

    this.isRunning = true;
    const startTime = Date.now();
    const result: CleanupResult = {
      eventsDeleted: 0,
      bytesFreed: 0,
      duration: 0,
      errors: []
    };

    try {
      if (this.config.debugMode) {
        console.log('StorageCleanup: Starting cleanup operation');
      }

      // Get initial storage size
      const initialSize = await this.storage.getSize();

      // Cleanup by retention policy
      const retentionResult = await this.cleanupByRetention();
      result.eventsDeleted += retentionResult.eventsDeleted;
      result.errors.push(...retentionResult.errors);

      // Cleanup by storage size limit
      const sizeResult = await this.cleanupByStorageSize();
      result.eventsDeleted += sizeResult.eventsDeleted;
      result.errors.push(...sizeResult.errors);

      // Calculate bytes freed
      const finalSize = await this.storage.getSize();
      result.bytesFreed = Math.max(0, initialSize - finalSize);
      result.duration = Date.now() - startTime;

      if (this.config.debugMode) {
        console.log('StorageCleanup: Cleanup completed:', result);
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`Cleanup failed: ${errorMessage}`);
      result.duration = Date.now() - startTime;

      if (this.config.debugMode) {
        console.error('StorageCleanup: Cleanup failed:', error);
      }

      return result;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Force cleanup operation
   */
  async forceCleanup(): Promise<CleanupResult> {
    return await this.performCleanup();
  }

  /**
   * Update cleanup configuration
   */
  updateConfig(newConfig: Partial<CleanupConfig>): void {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...newConfig };

    // Restart timer if interval changed
    if (oldConfig.cleanupInterval !== this.config.cleanupInterval) {
      if (this.cleanupTimer) {
        clearInterval(this.cleanupTimer);
        this.cleanupTimer = undefined;
      }

      if (this.config.enabled && this.config.cleanupInterval > 0) {
        this.cleanupTimer = setInterval(() => {
          this.performCleanup().catch(error => {
            if (this.config.debugMode) {
              console.error('StorageCleanup: Scheduled cleanup failed:', error);
            }
          });
        }, this.config.cleanupInterval);
      }
    }

    if (this.config.debugMode) {
      console.log('StorageCleanup: Configuration updated:', this.config);
    }
  }

  /**
   * Get cleanup status
   */
  getStatus(): {
    enabled: boolean;
    running: boolean;
    config: CleanupConfig;
    nextCleanup?: Date;
  } {
    const nextCleanup = this.cleanupTimer 
      ? new Date(Date.now() + this.config.cleanupInterval)
      : undefined;

    return {
      enabled: this.config.enabled,
      running: this.isRunning,
      config: this.config,
      nextCleanup
    };
  }

  /**
   * Dispose cleanup resources
   */
  async dispose(): Promise<void> {
    try {
      // Clear cleanup timer
      if (this.cleanupTimer) {
        clearInterval(this.cleanupTimer);
        this.cleanupTimer = undefined;
      }

      // Wait for current cleanup to finish
      while (this.isRunning) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      if (this.config.debugMode) {
        console.log('StorageCleanup: Disposed');
      }
    } catch (error) {
      if (this.config.debugMode) {
        console.error('StorageCleanup: Disposal failed:', error);
      }
    }
  }

  // Private helper methods

  private async cleanupByRetention(): Promise<CleanupResult> {
    const result: CleanupResult = {
      eventsDeleted: 0,
      bytesFreed: 0,
      duration: 0,
      errors: []
    };

    try {
      if (this.config.retentionDays <= 0) {
        return result;
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionDays);

      if (this.config.debugMode) {
        console.log('StorageCleanup: Cleaning events older than:', cutoffDate);
      }

      // Delete events in batches
      let totalDeleted = 0;
      let hasMore = true;

      while (hasMore) {
        const queryOptions: StorageQueryOptions = {
          endDate: cutoffDate,
          limit: this.config.batchSize
        };

        const eventsResult = await this.storage.getEvents(queryOptions);
        
        if (!eventsResult.success || !eventsResult.data || eventsResult.data.length === 0) {
          hasMore = false;
          break;
        }

        const eventIds = eventsResult.data.map(event => event.id);
        const deleteResult = await this.storage.deleteEvents(eventIds);

        if (deleteResult.success) {
          totalDeleted += eventIds.length;
          
          if (this.config.debugMode) {
            console.log('StorageCleanup: Deleted batch of', eventIds.length, 'old events');
          }
        } else {
          result.errors.push(`Failed to delete batch: ${deleteResult.error}`);
          hasMore = false;
        }

        // Check if we got fewer events than requested (end of data)
        if (eventsResult.data.length < this.config.batchSize) {
          hasMore = false;
        }
      }

      result.eventsDeleted = totalDeleted;

      if (this.config.debugMode) {
        console.log('StorageCleanup: Retention cleanup completed, deleted', totalDeleted, 'events');
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`Retention cleanup failed: ${errorMessage}`);
      return result;
    }
  }

  private async cleanupByStorageSize(): Promise<CleanupResult> {
    const result: CleanupResult = {
      eventsDeleted: 0,
      bytesFreed: 0,
      duration: 0,
      errors: []
    };

    try {
      if (this.config.maxStorageSize <= 0) {
        return result;
      }

      const currentSize = await this.storage.getSize();
      
      if (currentSize <= this.config.maxStorageSize) {
        if (this.config.debugMode) {
          console.log('StorageCleanup: Storage size within limit:', currentSize, '<=', this.config.maxStorageSize);
        }
        return result;
      }

      const targetSize = Math.floor(this.config.maxStorageSize * 0.8); // Clean to 80% of limit
      const bytesToFree = currentSize - targetSize;

      if (this.config.debugMode) {
        console.log('StorageCleanup: Storage size exceeded, need to free', bytesToFree, 'bytes');
      }

      // Delete oldest events in batches until we reach target size
      let totalDeleted = 0;
      let currentStorageSize = currentSize;

      while (currentStorageSize > targetSize) {
        const queryOptions: StorageQueryOptions = {
          limit: this.config.batchSize,
          orderBy: 'timestamp',
          orderDirection: 'asc' // Oldest first
        };

        const eventsResult = await this.storage.getEvents(queryOptions);
        
        if (!eventsResult.success || !eventsResult.data || eventsResult.data.length === 0) {
          break;
        }

        const eventIds = eventsResult.data.map(event => event.id);
        const deleteResult = await this.storage.deleteEvents(eventIds);

        if (deleteResult.success) {
          totalDeleted += eventIds.length;
          currentStorageSize = await this.storage.getSize();
          
          if (this.config.debugMode) {
            console.log('StorageCleanup: Deleted batch of', eventIds.length, 'events, size now:', currentStorageSize);
          }
        } else {
          result.errors.push(`Failed to delete batch for size cleanup: ${deleteResult.error}`);
          break;
        }

        // Safety check to prevent infinite loop
        if (eventsResult.data.length < this.config.batchSize) {
          break;
        }
      }

      result.eventsDeleted = totalDeleted;

      if (this.config.debugMode) {
        console.log('StorageCleanup: Size cleanup completed, deleted', totalDeleted, 'events');
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`Size cleanup failed: ${errorMessage}`);
      return result;
    }
  }
}
