/**
 * JSON Exporter for Telemetry Data
 * 
 * This module provides functionality to collect telemetry events in batches
 * and export them to a configured backend endpoint in the required JSON format.
 */

/**
 * Batch payload structure for the backend
 */
interface BatchPayload {
  timestamp: string;
  data: {
    type: 'batch';
    events: Record<string, any>[];
    batch_size: number;
    timestamp: string;
  };
}

/**
 * JsonExporter class that handles batched telemetry data export
 */
export class JsonExporter {
  private buffer: Record<string, any>[] = [];
  private readonly defaultBatchSize = 30;

  constructor(
    private exportUrl: string,
    private debug: boolean = false,
    private batchSize: number = 30
  ) {
    if (this.debug) {
      console.log(`JsonExporter: Initialized with exportUrl=${exportUrl}, batchSize=${batchSize}`);
    }
  }

  /**
   * Adds an event to the buffer and triggers export if batch size is reached
   * @param event The telemetry event to export
   */
  export(event: Record<string, any>): void {
    try {
      // Add event to buffer
      this.buffer.push(event);

      if (this.debug) {
        console.log(`JsonExporter: Event added to buffer. Buffer size: ${this.buffer.length}/${this.batchSize}`);
      }

      // Check if we should export the batch
      if (this.buffer.length >= this.batchSize) {
        this.exportBatch();
      }
    } catch (error) {
      if (this.debug) {
        console.error('JsonExporter: Failed to add event to buffer:', error);
      }
    }
  }

  /**
   * Forces export of current buffer regardless of batch size
   */
  flush(): void {
    if (this.buffer.length > 0) {
      this.exportBatch();
    }
  }

  /**
   * Gets the current buffer size
   * @returns Number of events in buffer
   */
  getBufferSize(): number {
    return this.buffer.length;
  }

  /**
   * Exports the current buffer as a batch to the configured endpoint
   */
  private async exportBatch(): Promise<void> {
    if (this.buffer.length === 0) {
      return;
    }

    // Create a copy of the buffer and clear it immediately
    const eventsToExport = [...this.buffer];
    this.buffer = [];

    const currentTimestamp = new Date().toISOString();

    // Create the batch payload according to backend format
    const payload: BatchPayload = {
      timestamp: currentTimestamp,
      data: {
        type: 'batch',
        events: eventsToExport,
        batch_size: eventsToExport.length,
        timestamp: currentTimestamp,
      },
    };

    if (this.debug) {
      console.log(`JsonExporter: Exporting batch of ${eventsToExport.length} events to ${this.exportUrl}`);
    }

    try {
      // Send POST request to export URL
      const response = await fetch(this.exportUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        if (this.debug) {
          console.log(`JsonExporter: Successfully exported batch of ${eventsToExport.length} events`);
        }
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      // If export fails, add events back to buffer for retry
      this.buffer.unshift(...eventsToExport);

      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (this.debug) {
        console.error(`JsonExporter: Failed to export batch: ${errorMessage}`);
        console.log(`JsonExporter: Events returned to buffer. Buffer size: ${this.buffer.length}`);
      }

      // In production, you might want to implement retry logic or dead letter queue here
    }
  }

  /**
   * Updates the export URL (useful for configuration changes)
   * @param newExportUrl New export URL
   */
  setExportUrl(newExportUrl: string): void {
    this.exportUrl = newExportUrl;
    
    if (this.debug) {
      console.log(`JsonExporter: Export URL updated to ${newExportUrl}`);
    }
  }

  /**
   * Updates the batch size (useful for configuration changes)
   * @param newBatchSize New batch size
   */
  setBatchSize(newBatchSize: number): void {
    this.batchSize = Math.max(1, newBatchSize); // Ensure minimum batch size of 1
    
    if (this.debug) {
      console.log(`JsonExporter: Batch size updated to ${this.batchSize}`);
    }
  }

  /**
   * Enables or disables debug logging
   * @param enabled Whether debug logging should be enabled
   */
  setDebugMode(enabled: boolean): void {
    this.debug = enabled;
    console.log(`JsonExporter: Debug mode ${enabled ? 'enabled' : 'disabled'}`);
  }
}
