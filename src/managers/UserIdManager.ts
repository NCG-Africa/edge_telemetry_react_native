import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * UserIdManager - Must generate same format as Flutter SDK
 * Format: user_<timestamp>_<random>
 * 
 * CRITICAL: This must produce identical user IDs to the Flutter implementation
 * to ensure backend compatibility
 */
export class UserIdManager {
  private static readonly USER_ID_KEY = 'edge_telemetry_user_id';
  private static readonly CUSTOM_USER_ID_KEY = 'edge_telemetry_custom_user_id';
  private static instance: UserIdManager;
  private userId?: string;
  private customUserId?: string;

  private constructor() {}

  static getInstance(): UserIdManager {
    if (!UserIdManager.instance) {
      UserIdManager.instance = new UserIdManager();
    }
    return UserIdManager.instance;
  }

  /**
   * Get the current user ID (custom or generated)
   * Priority: custom user ID > generated user ID
   */
  async getUserId(): Promise<string> {
    // Check for custom user ID first
    if (!this.customUserId) {
      try {
        this.customUserId = await AsyncStorage.getItem(UserIdManager.CUSTOM_USER_ID_KEY) || undefined;
      } catch (error) {
        console.warn('EdgeTelemetry: Failed to get custom user ID from storage:', error);
      }
    }

    if (this.customUserId) {
      return this.customUserId;
    }

    // Fall back to generated user ID
    if (this.userId) {
      return this.userId;
    }

    try {
      // Check AsyncStorage for existing generated user ID
      const storedUserId = await AsyncStorage.getItem(UserIdManager.USER_ID_KEY);
      
      if (storedUserId) {
        this.userId = storedUserId;
        return this.userId;
      }

      // Generate new user ID if none exists
      this.userId = this.generateUserId();
      
      // Persist to storage
      await AsyncStorage.setItem(UserIdManager.USER_ID_KEY, this.userId);
      
      return this.userId;
    } catch (error) {
      console.warn('EdgeTelemetry: Failed to get/set user ID from storage:', error);
      
      // Fallback: generate temporary user ID (not persisted)
      if (!this.userId) {
        this.userId = this.generateUserId();
      }
      
      return this.userId;
    }
  }

  /**
   * Set a custom user ID (typically provided by the app developer)
   * This takes priority over generated user IDs
   */
  async setCustomUserId(userId: string): Promise<void> {
    try {
      this.customUserId = userId;
      await AsyncStorage.setItem(UserIdManager.CUSTOM_USER_ID_KEY, userId);
    } catch (error) {
      console.warn('EdgeTelemetry: Failed to set custom user ID:', error);
      // Still set in memory even if storage fails
      this.customUserId = userId;
    }
  }

  /**
   * Clear the custom user ID, falling back to generated ID
   */
  async clearCustomUserId(): Promise<void> {
    try {
      await AsyncStorage.removeItem(UserIdManager.CUSTOM_USER_ID_KEY);
      this.customUserId = undefined;
    } catch (error) {
      console.warn('EdgeTelemetry: Failed to clear custom user ID:', error);
      this.customUserId = undefined;
    }
  }

  /**
   * Generate a new user ID matching Flutter format exactly
   * Format: user_<timestamp>_<random>
   * 
   * Example: user_1704067200000_x9y8z7w6
   */
  private generateUserId(): string {
    const timestamp = Date.now();
    const random = this.generateRandomString(8);
    
    return `user_${timestamp}_${random}`;
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
   * Check if we have a custom user ID set
   */
  hasCustomUserId(): boolean {
    return this.customUserId !== undefined;
  }

  /**
   * Get the current custom user ID (if any)
   */
  getCustomUserId(): string | undefined {
    return this.customUserId;
  }

  /**
   * Clear all user IDs (for testing or reset purposes)
   */
  async clearAllUserIds(): Promise<void> {
    try {
      await Promise.all([
        AsyncStorage.removeItem(UserIdManager.USER_ID_KEY),
        AsyncStorage.removeItem(UserIdManager.CUSTOM_USER_ID_KEY)
      ]);
      this.userId = undefined;
      this.customUserId = undefined;
    } catch (error) {
      console.warn('EdgeTelemetry: Failed to clear user IDs:', error);
      this.userId = undefined;
      this.customUserId = undefined;
    }
  }
}
