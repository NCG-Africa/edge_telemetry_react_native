import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

/**
 * DeviceIdManager - Must generate same format as Flutter SDK
 * Format: device_<timestamp>_<random>_<platform>
 * 
 * CRITICAL: This must produce identical device IDs to the Flutter implementation
 * to ensure backend compatibility
 */
export class DeviceIdManager {
  private static readonly DEVICE_ID_KEY = 'edge_telemetry_device_id';
  private static instance: DeviceIdManager;
  private deviceId?: string;

  private constructor() {}

  static getInstance(): DeviceIdManager {
    if (!DeviceIdManager.instance) {
      DeviceIdManager.instance = new DeviceIdManager();
    }
    return DeviceIdManager.instance;
  }

  /**
   * Get the device ID, generating one if it doesn't exist
   * Persists to AsyncStorage for consistency across app sessions
   */
  async getDeviceId(): Promise<string> {
    if (this.deviceId) {
      return this.deviceId;
    }

    try {
      // Check AsyncStorage for existing device ID
      const storedDeviceId = await AsyncStorage.getItem(DeviceIdManager.DEVICE_ID_KEY);
      
      if (storedDeviceId) {
        this.deviceId = storedDeviceId;
        return this.deviceId;
      }

      // Generate new device ID if none exists
      this.deviceId = this.generateDeviceId();
      
      // Persist to storage
      await AsyncStorage.setItem(DeviceIdManager.DEVICE_ID_KEY, this.deviceId);
      
      return this.deviceId;
    } catch (error) {
      console.warn('EdgeTelemetry: Failed to get/set device ID from storage:', error);
      
      // Fallback: generate temporary device ID (not persisted)
      if (!this.deviceId) {
        this.deviceId = this.generateDeviceId();
      }
      
      return this.deviceId;
    }
  }

  /**
   * Generate a new device ID matching Flutter format exactly
   * Format: device_<timestamp>_<random>_<platform>
   * 
   * Example: device_1704067200000_a8b9c2d1_android
   */
  private generateDeviceId(): string {
    const timestamp = Date.now();
    const random = this.generateRandomString(8);
    const platform = Platform.OS.toLowerCase();
    
    return `device_${timestamp}_${random}_${platform}`;
  }

  /**
   * Generate random alphanumeric string
   * Uses same character set as Flutter implementation
   */
  private generateRandomString(length: number): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    return result;
  }

  /**
   * Clear the stored device ID (for testing or reset purposes)
   */
  async clearDeviceId(): Promise<void> {
    try {
      await AsyncStorage.removeItem(DeviceIdManager.DEVICE_ID_KEY);
      this.deviceId = undefined;
    } catch (error) {
      console.warn('EdgeTelemetry: Failed to clear device ID:', error);
    }
  }

  /**
   * Check if device ID exists in storage
   */
  async hasStoredDeviceId(): Promise<boolean> {
    try {
      const storedId = await AsyncStorage.getItem(DeviceIdManager.DEVICE_ID_KEY);
      return storedId !== null;
    } catch {
      return false;
    }
  }
}
