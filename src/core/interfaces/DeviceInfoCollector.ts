/**
 * DeviceInfoCollector interface
 * Defines contract for collecting device and app information
 */
export interface DeviceInfoCollector {
  /**
   * Collect device information and return as string attributes
   * Must produce identical attributes to Flutter SDK
   */
  collectDeviceInfo(): Promise<Record<string, string>>;
  
  /**
   * Collect app-specific information
   */
  collectAppInfo(): Promise<Record<string, string>>;
  
  /**
   * Get platform-specific attributes
   */
  getPlatformAttributes(): Promise<Record<string, string>>;
}
