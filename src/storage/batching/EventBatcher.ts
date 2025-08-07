import type { TelemetryEvent } from '../../core/models/TelemetryEvent';
import type { 
  EventBatcher as IEventBatcher, 
  EventBatch, 
  BatchConfig 
} from '../types/StorageTypes';

/**
 * EventBatcher - Handles telemetry event batching and retry logic
 * Phase 11: Storage & Caching Layer
 */
export class EventBatcher implements IEventBatcher {
  private config: BatchConfig;
  private currentBatch: TelemetryEvent[] = [];
  private pendingBatches = new Map<string, EventBatch>();
  private batchTimer?: any;
  private isInitialized = false;
  private batchIdCounter = 0;

  constructor(config: Partial<BatchConfig> = {}) {
    this.config = {
      maxBatchSize: config.maxBatchSize || 30,
      maxBatchSizeBytes: config.maxBatchSizeBytes || 1024 * 1024, // 1MB
      batchTimeout: config.batchTimeout || 30000, // 30 seconds
      maxRetries: config.maxRetries || 3,
      retryBackoffMs: config.retryBackoffMs || 5000, // 5 seconds
      enableCompression: config.enableCompression || false,
      debugMode: config.debugMode || false
    };
  }

  /**
   * Initialize batcher
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Start batch timer
      this.startBatchTimer();

      this.isInitialized = true;

      if (this.config.debugMode) {
        console.log('EventBatcher: Initialized with config:', this.config);
      }
    } catch (error) {
      if (this.config.debugMode) {
        console.error('EventBatcher: Initialization failed:', error);
      }
      throw error;
    }
  }

  /**
   * Add event to batch
   */
  async addEvent(event: TelemetryEvent): Promise<void> {
    if (!this.isInitialized) {
      if (this.config.debugMode) {
        console.warn('EventBatcher: Batcher not initialized');
      }
      return;
    }

    try {
      this.currentBatch.push(event);

      if (this.config.debugMode) {
        console.log('EventBatcher: Added event to batch, current size:', this.currentBatch.length);
      }

      // Check if we should flush the batch
      if (this.shouldFlushBatch()) {
        await this.flushCurrentBatch();
      }
    } catch (error) {
      if (this.config.debugMode) {
        console.error('EventBatcher: Failed to add event:', error);
      }
    }
  }

  /**
   * Add multiple events to batch
   */
  async addEvents(events: TelemetryEvent[]): Promise<void> {
    if (!this.isInitialized) {
      if (this.config.debugMode) {
        console.warn('EventBatcher: Batcher not initialized');
      }
      return;
    }

    try {
      for (const event of events) {
        await this.addEvent(event);
      }
    } catch (error) {
      if (this.config.debugMode) {
        console.error('EventBatcher: Failed to add events:', error);
      }
    }
  }

  /**
   * Force flush current batch
   */
  async flush(): Promise<EventBatch[]> {
    if (!this.isInitialized) {
      return [];
    }

    try {
      const batches: EventBatch[] = [];

      // Flush current batch if not empty
      if (this.currentBatch.length > 0) {
        const batch = await this.flushCurrentBatch();
        if (batch) {
          batches.push(batch);
        }
      }

      if (this.config.debugMode) {
        console.log('EventBatcher: Force flushed', batches.length, 'batches');
      }

      return batches;
    } catch (error) {
      if (this.config.debugMode) {
        console.error('EventBatcher: Failed to flush:', error);
      }
      return [];
    }
  }

  /**
   * Get pending batches
   */
  async getPendingBatches(): Promise<EventBatch[]> {
    if (!this.isInitialized) {
      return [];
    }

    try {
      const batches = Array.from(this.pendingBatches.values());
      
      // Filter out batches that are not ready for retry
      const now = new Date();
      const readyBatches = batches.filter(batch => {
        if (batch.status === 'completed') {
          return false;
        }
        if (batch.nextRetryAt && batch.nextRetryAt > now) {
          return false;
        }
        return true;
      });

      return readyBatches;
    } catch (error) {
      if (this.config.debugMode) {
        console.error('EventBatcher: Failed to get pending batches:', error);
      }
      return [];
    }
  }

  /**
   * Mark batch as completed
   */
  async markBatchCompleted(batchId: string): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    try {
      const batch = this.pendingBatches.get(batchId);
      if (batch) {
        batch.status = 'completed';
        
        // Remove completed batch after a delay to allow for status queries
        setTimeout(() => {
          this.pendingBatches.delete(batchId);
        }, 60000); // 1 minute

        if (this.config.debugMode) {
          console.log('EventBatcher: Batch completed:', batchId);
        }
      }
    } catch (error) {
      if (this.config.debugMode) {
        console.error('EventBatcher: Failed to mark batch completed:', error);
      }
    }
  }

  /**
   * Mark batch as failed
   */
  async markBatchFailed(batchId: string, error: string): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    try {
      const batch = this.pendingBatches.get(batchId);
      if (batch) {
        batch.retryCount++;
        
        if (batch.retryCount >= batch.maxRetries) {
          batch.status = 'failed';
          
          if (this.config.debugMode) {
            console.error('EventBatcher: Batch permanently failed:', batchId, error);
          }
        } else {
          batch.status = 'pending';
          batch.nextRetryAt = new Date(Date.now() + this.config.retryBackoffMs * batch.retryCount);
          
          if (this.config.debugMode) {
            console.warn('EventBatcher: Batch failed, will retry:', batchId, 'attempt:', batch.retryCount);
          }
        }
      }
    } catch (error) {
      if (this.config.debugMode) {
        console.error('EventBatcher: Failed to mark batch failed:', error);
      }
    }
  }

  /**
   * Retry failed batches
   */
  async retryFailedBatches(): Promise<EventBatch[]> {
    if (!this.isInitialized) {
      return [];
    }

    try {
      const now = new Date();
      const retryBatches: EventBatch[] = [];

      for (const batch of this.pendingBatches.values()) {
        if (batch.status === 'pending' && 
            batch.retryCount < batch.maxRetries &&
            (!batch.nextRetryAt || batch.nextRetryAt <= now)) {
          
          batch.status = 'processing';
          retryBatches.push(batch);
        }
      }

      if (this.config.debugMode && retryBatches.length > 0) {
        console.log('EventBatcher: Retrying', retryBatches.length, 'failed batches');
      }

      return retryBatches;
    } catch (error) {
      if (this.config.debugMode) {
        console.error('EventBatcher: Failed to retry batches:', error);
      }
      return [];
    }
  }

  /**
   * Get batcher statistics
   */
  getStats(): {
    pendingBatches: number;
    totalEvents: number;
    completedBatches: number;
    failedBatches: number;
  } {
    const batches = Array.from(this.pendingBatches.values());
    
    return {
      pendingBatches: batches.filter(b => b.status === 'pending' || b.status === 'processing').length,
      totalEvents: this.currentBatch.length + batches.reduce((sum, b) => sum + b.events.length, 0),
      completedBatches: batches.filter(b => b.status === 'completed').length,
      failedBatches: batches.filter(b => b.status === 'failed').length
    };
  }

  /**
   * Dispose batcher resources
   */
  async dispose(): Promise<void> {
    try {
      // Clear batch timer
      if (this.batchTimer) {
        clearTimeout(this.batchTimer);
        this.batchTimer = undefined;
      }

      // Flush any remaining events
      if (this.currentBatch.length > 0) {
        await this.flushCurrentBatch();
      }

      this.isInitialized = false;

      if (this.config.debugMode) {
        console.log('EventBatcher: Disposed');
      }
    } catch (error) {
      if (this.config.debugMode) {
        console.error('EventBatcher: Disposal failed:', error);
      }
    }
  }

  // Private helper methods

  private shouldFlushBatch(): boolean {
    if (this.currentBatch.length === 0) {
      return false;
    }

    // Check batch size limit
    if (this.currentBatch.length >= this.config.maxBatchSize) {
      return true;
    }

    // Check batch size in bytes
    const batchSize = this.calculateBatchSize(this.currentBatch);
    if (batchSize >= this.config.maxBatchSizeBytes) {
      return true;
    }

    return false;
  }

  private async flushCurrentBatch(): Promise<EventBatch | null> {
    if (this.currentBatch.length === 0) {
      return null;
    }

    try {
      const batchId = this.generateBatchId();
      const events = [...this.currentBatch];
      const batchSize = this.calculateBatchSize(events);

      const batch: EventBatch = {
        id: batchId,
        events,
        createdAt: new Date(),
        size: batchSize,
        retryCount: 0,
        maxRetries: this.config.maxRetries,
        status: 'pending'
      };

      // Store batch
      this.pendingBatches.set(batchId, batch);

      // Clear current batch
      this.currentBatch = [];

      // Restart batch timer
      this.startBatchTimer();

      if (this.config.debugMode) {
        console.log('EventBatcher: Created batch:', batchId, 'with', events.length, 'events');
      }

      return batch;
    } catch (error) {
      if (this.config.debugMode) {
        console.error('EventBatcher: Failed to flush batch:', error);
      }
      return null;
    }
  }

  private calculateBatchSize(events: TelemetryEvent[]): number {
    try {
      const serialized = JSON.stringify(events);
      return new Blob([serialized]).size;
    } catch (error) {
      if (this.config.debugMode) {
        console.warn('EventBatcher: Failed to calculate batch size:', error);
      }
      // Fallback estimation
      return events.length * 1024; // Rough estimate: 1KB per event
    }
  }

  private generateBatchId(): string {
    return `batch_${Date.now()}_${++this.batchIdCounter}`;
  }

  private startBatchTimer(): void {
    // Clear existing timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }

    // Start new timer
    this.batchTimer = setTimeout(async () => {
      if (this.currentBatch.length > 0) {
        await this.flushCurrentBatch();
      }
    }, this.config.batchTimeout);
  }
}
