/**
 * Duration class to mirror Flutter's Duration exactly
 * Provides consistent timing measurements across the SDK
 */
export class Duration {
  private readonly _milliseconds: number;
  
  constructor(milliseconds: number) {
    this._milliseconds = Math.max(0, Math.round(milliseconds));
  }
  
  /**
   * Get duration in milliseconds (matches Flutter's inMilliseconds)
   */
  get inMilliseconds(): number {
    return this._milliseconds;
  }
  
  /**
   * Get duration in seconds
   */
  get inSeconds(): number {
    return this._milliseconds / 1000;
  }
  
  /**
   * Get duration in microseconds (matches Flutter's inMicroseconds)
   */
  get inMicroseconds(): number {
    return this._milliseconds * 1000;
  }
  
  /**
   * Create Duration from seconds
   */
  static fromSeconds(seconds: number): Duration {
    return new Duration(seconds * 1000);
  }
  
  /**
   * Create Duration from microseconds
   */
  static fromMicroseconds(microseconds: number): Duration {
    return new Duration(microseconds / 1000);
  }
  
  /**
   * String representation for debugging
   */
  toString(): string {
    if (this._milliseconds < 1000) {
      return `${this._milliseconds}ms`;
    } else {
      return `${(this._milliseconds / 1000).toFixed(2)}s`;
    }
  }
  
  /**
   * Compare durations
   */
  equals(other: Duration): boolean {
    return this._milliseconds === other._milliseconds;
  }
  
  /**
   * Check if this duration is longer than another
   */
  isLongerThan(other: Duration): boolean {
    return this._milliseconds > other._milliseconds;
  }
  
  /**
   * Check if this duration is shorter than another
   */
  isShorterThan(other: Duration): boolean {
    return this._milliseconds < other._milliseconds;
  }
}
