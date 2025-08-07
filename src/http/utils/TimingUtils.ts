import { Duration } from './Duration';

/**
 * Timing utilities for HTTP monitoring
 * Provides high-precision timing measurements
 */
export class TimingUtils {
  /**
   * Get current timestamp in milliseconds with high precision
   */
  static now(): number {
    if (typeof performance !== 'undefined' && performance.now) {
      return performance.now();
    }
    return Date.now();
  }
  
  /**
   * Create a timer that can be stopped to measure duration
   */
  static createTimer(): Timer {
    return new Timer();
  }
  
  /**
   * Measure execution time of a function
   */
  static async measureAsync<T>(fn: () => Promise<T>): Promise<{ result: T; duration: Duration }> {
    const timer = this.createTimer();
    const result = await fn();
    const duration = timer.stop();
    return { result, duration };
  }
  
  /**
   * Measure execution time of a synchronous function
   */
  static measure<T>(fn: () => T): { result: T; duration: Duration } {
    const timer = this.createTimer();
    const result = fn();
    const duration = timer.stop();
    return { result, duration };
  }
  
  /**
   * Convert milliseconds to Duration
   */
  static toDuration(milliseconds: number): Duration {
    return new Duration(milliseconds);
  }
  
  /**
   * Get ISO timestamp string
   */
  static getISOTimestamp(date: Date = new Date()): string {
    return date.toISOString();
  }
  
  /**
   * Get Unix timestamp in milliseconds
   */
  static getUnixTimestamp(date: Date = new Date()): number {
    return date.getTime();
  }
}

/**
 * Timer class for measuring durations
 */
export class Timer {
  private startTime: number;
  private endTime?: number;
  
  constructor() {
    this.startTime = TimingUtils.now();
  }
  
  /**
   * Stop the timer and return the duration
   */
  stop(): Duration {
    if (this.endTime === undefined) {
      this.endTime = TimingUtils.now();
    }
    
    const elapsed = this.endTime - this.startTime;
    return new Duration(elapsed);
  }
  
  /**
   * Get elapsed time without stopping the timer
   */
  elapsed(): Duration {
    const currentTime = TimingUtils.now();
    const elapsed = currentTime - this.startTime;
    return new Duration(elapsed);
  }
  
  /**
   * Reset the timer
   */
  reset(): void {
    this.startTime = TimingUtils.now();
    this.endTime = undefined;
  }
  
  /**
   * Check if timer has been stopped
   */
  get isStopped(): boolean {
    return this.endTime !== undefined;
  }
}
