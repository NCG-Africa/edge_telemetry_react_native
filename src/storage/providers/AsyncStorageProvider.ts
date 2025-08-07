import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TelemetryEvent } from '../../core/models/TelemetryEvent';
import type { 
  TelemetryStorage, 
  StorageResult, 
  StorageQueryOptions, 
  StorageStats 
} from '../types/StorageTypes';

/**
 * AsyncStorageProvider - React Native AsyncStorage implementation
 * Phase 11: Storage & Caching Layer
 */
export class AsyncStorageProvider implements TelemetryStorage {
  private static readonly EVENTS_KEY_PREFIX = 'edge_telemetry_event_';
  private static readonly METADATA_KEY = 'edge_telemetry_metadata';
  private static readonly INDEX_KEY = 'edge_telemetry_index';
  
  private isInitialized = false;
  private debugMode = false;
  private eventIndex: Set<string> = new Set();
  private metadata: Record<string, any> = {};

  constructor(debugMode = false) {
    this.debugMode = debugMode;
  }

  /**
   * Initialize AsyncStorage provider
   */
  async initialize(): Promise<StorageResult<void>> {
    if (this.isInitialized) {
      return { success: true };
    }

    try {
      // Check if AsyncStorage is available
      if (!await this.isAvailable()) {
        return {
          success: false,
          error: 'AsyncStorage is not available'
        };
      }

      // Load event index
      await this.loadEventIndex();

      // Load metadata
      await this.loadMetadata();

      this.isInitialized = true;

      if (this.debugMode) {
        console.log('AsyncStorageProvider: Initialized with', this.eventIndex.size, 'events');
      }

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (this.debugMode) {
        console.error('AsyncStorageProvider: Initialization failed:', error);
      }
      return {
        success: false,
        error: `Failed to initialize AsyncStorage: ${errorMessage}`
      };
    }
  }

  /**
   * Store single telemetry event
   */
  async storeEvent(event: TelemetryEvent): Promise<StorageResult<string>> {
    if (!this.isInitialized) {
      return {
        success: false,
        error: 'Storage not initialized'
      };
    }

    try {
      const eventKey = this.getEventKey(event.id);
      const eventData = JSON.stringify(event);
      
      // Store event
      await AsyncStorage.setItem(eventKey, eventData);
      
      // Update index
      this.eventIndex.add(event.id);
      await this.saveEventIndex();
      
      // Update metadata
      this.updateMetadata(event);
      await this.saveMetadata();

      if (this.debugMode) {
        console.log('AsyncStorageProvider: Event stored:', event.id);
      }

      return {
        success: true,
        data: event.id,
        timestamp: Date.now()
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (this.debugMode) {
        console.error('AsyncStorageProvider: Failed to store event:', error);
      }
      return {
        success: false,
        error: `Failed to store event: ${errorMessage}`
      };
    }
  }

  /**
   * Store multiple telemetry events
   */
  async storeEvents(events: TelemetryEvent[]): Promise<StorageResult<string[]>> {
    if (!this.isInitialized) {
      return {
        success: false,
        error: 'Storage not initialized'
      };
    }

    try {
      const pairs: [string, string][] = [];
      const eventIds: string[] = [];

      // Prepare all events for batch storage
      for (const event of events) {
        const eventKey = this.getEventKey(event.id);
        const eventData = JSON.stringify(event);
        pairs.push([eventKey, eventData]);
        eventIds.push(event.id);
        
        // Update index
        this.eventIndex.add(event.id);
        
        // Update metadata
        this.updateMetadata(event);
      }

      // Batch store events
      await AsyncStorage.multiSet(pairs);
      
      // Save updated index and metadata
      await Promise.all([
        this.saveEventIndex(),
        this.saveMetadata()
      ]);

      if (this.debugMode) {
        console.log('AsyncStorageProvider: Stored', events.length, 'events');
      }

      return {
        success: true,
        data: eventIds,
        timestamp: Date.now()
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (this.debugMode) {
        console.error('AsyncStorageProvider: Failed to store events:', error);
      }
      return {
        success: false,
        error: `Failed to store events: ${errorMessage}`
      };
    }
  }

  /**
   * Retrieve events by query
   */
  async getEvents(options: StorageQueryOptions = {}): Promise<StorageResult<TelemetryEvent[]>> {
    if (!this.isInitialized) {
      return {
        success: false,
        error: 'Storage not initialized'
      };
    }

    try {
      // Get event IDs based on query
      const eventIds = this.filterEventIds(options);
      
      if (eventIds.length === 0) {
        return {
          success: true,
          data: [],
          timestamp: Date.now()
        };
      }

      // Get event keys
      const eventKeys = eventIds.map(id => this.getEventKey(id));
      
      // Batch retrieve events
      const eventPairs = await AsyncStorage.multiGet(eventKeys);
      const events: TelemetryEvent[] = [];

      for (const [key, value] of eventPairs) {
        if (value) {
          try {
            const event = JSON.parse(value) as TelemetryEvent;
            // Convert timestamp string back to Date if needed
            if (typeof event.timestamp === 'string') {
              event.timestamp = new Date(event.timestamp);
            }
            events.push(event);
          } catch (parseError) {
            if (this.debugMode) {
              console.warn('AsyncStorageProvider: Failed to parse event:', key, parseError);
            }
          }
        }
      }

      // Apply additional filtering and sorting
      const filteredEvents = this.applyQueryFilters(events, options);

      if (this.debugMode) {
        console.log('AsyncStorageProvider: Retrieved', filteredEvents.length, 'events');
      }

      return {
        success: true,
        data: filteredEvents,
        timestamp: Date.now()
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (this.debugMode) {
        console.error('AsyncStorageProvider: Failed to get events:', error);
      }
      return {
        success: false,
        error: `Failed to get events: ${errorMessage}`
      };
    }
  }

  /**
   * Get event by ID
   */
  async getEvent(id: string): Promise<StorageResult<TelemetryEvent>> {
    if (!this.isInitialized) {
      return {
        success: false,
        error: 'Storage not initialized'
      };
    }

    try {
      if (!this.eventIndex.has(id)) {
        return {
          success: false,
          error: 'Event not found'
        };
      }

      const eventKey = this.getEventKey(id);
      const eventData = await AsyncStorage.getItem(eventKey);

      if (!eventData) {
        return {
          success: false,
          error: 'Event not found'
        };
      }

      const event = JSON.parse(eventData) as TelemetryEvent;
      
      // Convert timestamp string back to Date if needed
      if (typeof event.timestamp === 'string') {
        event.timestamp = new Date(event.timestamp);
      }

      return {
        success: true,
        data: event,
        timestamp: Date.now()
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (this.debugMode) {
        console.error('AsyncStorageProvider: Failed to get event:', error);
      }
      return {
        success: false,
        error: `Failed to get event: ${errorMessage}`
      };
    }
  }

  /**
   * Delete event by ID
   */
  async deleteEvent(id: string): Promise<StorageResult<void>> {
    if (!this.isInitialized) {
      return {
        success: false,
        error: 'Storage not initialized'
      };
    }

    try {
      if (!this.eventIndex.has(id)) {
        return {
          success: false,
          error: 'Event not found'
        };
      }

      const eventKey = this.getEventKey(id);
      
      // Delete event
      await AsyncStorage.removeItem(eventKey);
      
      // Update index
      this.eventIndex.delete(id);
      await this.saveEventIndex();
      
      // Update metadata
      await this.updateMetadataAfterDeletion();

      if (this.debugMode) {
        console.log('AsyncStorageProvider: Event deleted:', id);
      }

      return {
        success: true,
        timestamp: Date.now()
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (this.debugMode) {
        console.error('AsyncStorageProvider: Failed to delete event:', error);
      }
      return {
        success: false,
        error: `Failed to delete event: ${errorMessage}`
      };
    }
  }

  /**
   * Delete multiple events by IDs
   */
  async deleteEvents(ids: string[]): Promise<StorageResult<void>> {
    if (!this.isInitialized) {
      return {
        success: false,
        error: 'Storage not initialized'
      };
    }

    try {
      const existingIds = ids.filter(id => this.eventIndex.has(id));
      
      if (existingIds.length === 0) {
        return {
          success: true,
          timestamp: Date.now()
        };
      }

      const eventKeys = existingIds.map(id => this.getEventKey(id));
      
      // Batch delete events
      await AsyncStorage.multiRemove(eventKeys);
      
      // Update index
      existingIds.forEach(id => this.eventIndex.delete(id));
      await this.saveEventIndex();
      
      // Update metadata
      await this.updateMetadataAfterDeletion();

      if (this.debugMode) {
        console.log('AsyncStorageProvider: Deleted', existingIds.length, 'events');
      }

      return {
        success: true,
        timestamp: Date.now()
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (this.debugMode) {
        console.error('AsyncStorageProvider: Failed to delete events:', error);
      }
      return {
        success: false,
        error: `Failed to delete events: ${errorMessage}`
      };
    }
  }

  /**
   * Delete events by query
   */
  async deleteEventsByQuery(options: StorageQueryOptions): Promise<StorageResult<number>> {
    if (!this.isInitialized) {
      return {
        success: false,
        error: 'Storage not initialized'
      };
    }

    try {
      // Get events to delete
      const eventsResult = await this.getEvents(options);
      
      if (!eventsResult.success || !eventsResult.data) {
        return {
          success: false,
          error: eventsResult.error || 'Failed to get events for deletion'
        };
      }

      const eventIds = eventsResult.data.map(event => event.id);
      
      if (eventIds.length === 0) {
        return {
          success: true,
          data: 0,
          timestamp: Date.now()
        };
      }

      // Delete events
      const deleteResult = await this.deleteEvents(eventIds);
      
      if (!deleteResult.success) {
        return {
          success: false,
          error: deleteResult.error
        };
      }

      return {
        success: true,
        data: eventIds.length,
        timestamp: Date.now()
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (this.debugMode) {
        console.error('AsyncStorageProvider: Failed to delete events by query:', error);
      }
      return {
        success: false,
        error: `Failed to delete events by query: ${errorMessage}`
      };
    }
  }

  /**
   * Clear all events
   */
  async clearAllEvents(): Promise<StorageResult<void>> {
    if (!this.isInitialized) {
      return {
        success: false,
        error: 'Storage not initialized'
      };
    }

    try {
      // Get all event keys
      const eventKeys = Array.from(this.eventIndex).map(id => this.getEventKey(id));
      
      if (eventKeys.length > 0) {
        // Batch delete all events
        await AsyncStorage.multiRemove(eventKeys);
      }
      
      // Clear index and metadata
      this.eventIndex.clear();
      this.metadata = {};
      
      await Promise.all([
        this.saveEventIndex(),
        this.saveMetadata()
      ]);

      if (this.debugMode) {
        console.log('AsyncStorageProvider: All events cleared');
      }

      return {
        success: true,
        timestamp: Date.now()
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (this.debugMode) {
        console.error('AsyncStorageProvider: Failed to clear all events:', error);
      }
      return {
        success: false,
        error: `Failed to clear all events: ${errorMessage}`
      };
    }
  }

  /**
   * Get storage statistics
   */
  async getStats(): Promise<StorageResult<StorageStats>> {
    if (!this.isInitialized) {
      return {
        success: false,
        error: 'Storage not initialized'
      };
    }

    try {
      const totalEvents = this.eventIndex.size;
      const totalSize = await this.calculateTotalSize();
      
      const stats: StorageStats = {
        totalEvents,
        totalSize,
        oldestEvent: this.metadata.oldestEvent ? new Date(this.metadata.oldestEvent) : undefined,
        newestEvent: this.metadata.newestEvent ? new Date(this.metadata.newestEvent) : undefined,
        eventsByType: { ...this.metadata.eventsByType } || {},
        storageUsage: 0, // AsyncStorage doesn't provide usage info
        lastCleanup: this.metadata.lastCleanup ? new Date(this.metadata.lastCleanup) : undefined
      };

      return {
        success: true,
        data: stats,
        timestamp: Date.now()
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (this.debugMode) {
        console.error('AsyncStorageProvider: Failed to get stats:', error);
      }
      return {
        success: false,
        error: `Failed to get stats: ${errorMessage}`
      };
    }
  }

  /**
   * Cleanup old events based on retention policy
   */
  async cleanup(retentionDays: number): Promise<StorageResult<number>> {
    if (!this.isInitialized) {
      return {
        success: false,
        error: 'Storage not initialized'
      };
    }

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      // Delete events older than cutoff date
      const deleteResult = await this.deleteEventsByQuery({
        endDate: cutoffDate
      });

      if (!deleteResult.success) {
        return deleteResult;
      }

      // Update metadata
      this.metadata.lastCleanup = new Date().toISOString();
      await this.saveMetadata();

      const deletedCount = deleteResult.data || 0;

      if (this.debugMode) {
        console.log('AsyncStorageProvider: Cleanup completed, deleted', deletedCount, 'events');
      }

      return {
        success: true,
        data: deletedCount,
        timestamp: Date.now()
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (this.debugMode) {
        console.error('AsyncStorageProvider: Cleanup failed:', error);
      }
      return {
        success: false,
        error: `Cleanup failed: ${errorMessage}`
      };
    }
  }

  /**
   * Check if storage is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const testKey = 'edge_telemetry_test';
      await AsyncStorage.setItem(testKey, 'test');
      await AsyncStorage.removeItem(testKey);
      return true;
    } catch (error) {
      if (this.debugMode) {
        console.warn('AsyncStorageProvider: Storage not available:', error);
      }
      return false;
    }
  }

  /**
   * Get storage size in bytes
   */
  async getSize(): Promise<number> {
    try {
      return await this.calculateTotalSize();
    } catch (error) {
      if (this.debugMode) {
        console.warn('AsyncStorageProvider: Failed to calculate size:', error);
      }
      return 0;
    }
  }

  /**
   * Dispose storage resources
   */
  async dispose(): Promise<void> {
    this.isInitialized = false;
    this.eventIndex.clear();
    this.metadata = {};

    if (this.debugMode) {
      console.log('AsyncStorageProvider: Disposed');
    }
  }

  // Private helper methods

  private getEventKey(eventId: string): string {
    return `${AsyncStorageProvider.EVENTS_KEY_PREFIX}${eventId}`;
  }

  private async loadEventIndex(): Promise<void> {
    try {
      const indexData = await AsyncStorage.getItem(AsyncStorageProvider.INDEX_KEY);
      if (indexData) {
        const indexArray = JSON.parse(indexData) as string[];
        this.eventIndex = new Set(indexArray);
      }
    } catch (error) {
      if (this.debugMode) {
        console.warn('AsyncStorageProvider: Failed to load event index:', error);
      }
      this.eventIndex = new Set();
    }
  }

  private async saveEventIndex(): Promise<void> {
    try {
      const indexArray = Array.from(this.eventIndex);
      await AsyncStorage.setItem(AsyncStorageProvider.INDEX_KEY, JSON.stringify(indexArray));
    } catch (error) {
      if (this.debugMode) {
        console.error('AsyncStorageProvider: Failed to save event index:', error);
      }
    }
  }

  private async loadMetadata(): Promise<void> {
    try {
      const metadataData = await AsyncStorage.getItem(AsyncStorageProvider.METADATA_KEY);
      if (metadataData) {
        this.metadata = JSON.parse(metadataData);
      }
    } catch (error) {
      if (this.debugMode) {
        console.warn('AsyncStorageProvider: Failed to load metadata:', error);
      }
      this.metadata = {};
    }
  }

  private async saveMetadata(): Promise<void> {
    try {
      await AsyncStorage.setItem(AsyncStorageProvider.METADATA_KEY, JSON.stringify(this.metadata));
    } catch (error) {
      if (this.debugMode) {
        console.error('AsyncStorageProvider: Failed to save metadata:', error);
      }
    }
  }

  private updateMetadata(event: TelemetryEvent): void {
    // Update event counts by type
    if (!this.metadata.eventsByType) {
      this.metadata.eventsByType = {};
    }
    this.metadata.eventsByType[event.eventName] = (this.metadata.eventsByType[event.eventName] || 0) + 1;

    // Update oldest/newest event timestamps
    const eventTime = event.timestamp.toISOString();
    if (!this.metadata.oldestEvent || eventTime < this.metadata.oldestEvent) {
      this.metadata.oldestEvent = eventTime;
    }
    if (!this.metadata.newestEvent || eventTime > this.metadata.newestEvent) {
      this.metadata.newestEvent = eventTime;
    }
  }

  private async updateMetadataAfterDeletion(): Promise<void> {
    // Recalculate metadata after deletion
    // This is expensive but necessary for accuracy
    try {
      const eventsResult = await this.getEvents();
      if (eventsResult.success && eventsResult.data) {
        const events = eventsResult.data;
        
        // Reset metadata
        this.metadata.eventsByType = {};
        this.metadata.oldestEvent = undefined;
        this.metadata.newestEvent = undefined;
        
        // Recalculate
        for (const event of events) {
          this.updateMetadata(event);
        }
        
        await this.saveMetadata();
      }
    } catch (error) {
      if (this.debugMode) {
        console.warn('AsyncStorageProvider: Failed to update metadata after deletion:', error);
      }
    }
  }

  private filterEventIds(options: StorageQueryOptions): string[] {
    let eventIds = Array.from(this.eventIndex);

    // Apply limit and offset
    if (options.offset) {
      eventIds = eventIds.slice(options.offset);
    }
    if (options.limit) {
      eventIds = eventIds.slice(0, options.limit);
    }

    return eventIds;
  }

  private applyQueryFilters(events: TelemetryEvent[], options: StorageQueryOptions): TelemetryEvent[] {
    let filteredEvents = [...events];

    // Apply date filters
    if (options.startDate) {
      filteredEvents = filteredEvents.filter(event => event.timestamp >= options.startDate!);
    }
    if (options.endDate) {
      filteredEvents = filteredEvents.filter(event => event.timestamp <= options.endDate!);
    }

    // Apply custom filters
    if (options.filters) {
      for (const [key, value] of Object.entries(options.filters)) {
        filteredEvents = filteredEvents.filter(event => {
          const eventValue = (event as any)[key] || event.attributes?.[key];
          return eventValue === value;
        });
      }
    }

    // Apply sorting
    if (options.orderBy) {
      const orderBy = options.orderBy;
      const orderDirection = options.orderDirection || 'asc';
      
      filteredEvents.sort((a, b) => {
        const aValue = (a as any)[orderBy] || a.attributes?.[orderBy];
        const bValue = (b as any)[orderBy] || b.attributes?.[orderBy];
        
        if (aValue < bValue) return orderDirection === 'asc' ? -1 : 1;
        if (aValue > bValue) return orderDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return filteredEvents;
  }

  private async calculateTotalSize(): Promise<number> {
    try {
      // Get all event keys
      const eventKeys = Array.from(this.eventIndex).map(id => this.getEventKey(id));
      
      if (eventKeys.length === 0) {
        return 0;
      }

      // Get all events
      const eventPairs = await AsyncStorage.multiGet(eventKeys);
      let totalSize = 0;

      for (const [key, value] of eventPairs) {
        if (value) {
          totalSize += new Blob([value]).size;
        }
      }

      // Add metadata and index size
      const metadataSize = new Blob([JSON.stringify(this.metadata)]).size;
      const indexSize = new Blob([JSON.stringify(Array.from(this.eventIndex))]).size;
      
      return totalSize + metadataSize + indexSize;
    } catch (error) {
      if (this.debugMode) {
        console.warn('AsyncStorageProvider: Failed to calculate total size:', error);
      }
      return 0;
    }
  }
}
