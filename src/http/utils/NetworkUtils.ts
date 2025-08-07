import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

/**
 * Network connection type enum matching Flutter SDK
 */
export enum NetworkConnectionType {
  WIFI = 'wifi',
  CELLULAR = 'cellular',
  ETHERNET = 'ethernet',
  BLUETOOTH = 'bluetooth',
  VPN = 'vpn',
  OTHER = 'other',
  NONE = 'none',
  UNKNOWN = 'unknown'
}

/**
 * Network quality enum matching Flutter SDK
 */
export enum NetworkQuality {
  EXCELLENT = 'excellent',
  GOOD = 'good',
  FAIR = 'fair',
  POOR = 'poor',
  UNKNOWN = 'unknown'
}

/**
 * Network information interface
 */
export interface NetworkInfo {
  isConnected: boolean;
  connectionType: NetworkConnectionType;
  quality: NetworkQuality;
  isExpensive: boolean;
  strength?: number; // Signal strength (0-100)
}

/**
 * Network utilities for HTTP monitoring
 * Provides network state detection and quality assessment
 */
export class NetworkUtils {
  private static currentNetworkInfo: NetworkInfo | null = null;
  private static listeners: ((info: NetworkInfo) => void)[] = [];
  private static isInitialized = false;
  
  /**
   * Initialize network monitoring
   */
  static async initialize(): Promise<void> {
    if (this.isInitialized) return;
    
    try {
      // Get initial network state
      const state = await NetInfo.fetch();
      this.currentNetworkInfo = this.parseNetInfoState(state);
      
      // Subscribe to network state changes
      NetInfo.addEventListener(state => {
        const networkInfo = this.parseNetInfoState(state);
        this.currentNetworkInfo = networkInfo;
        
        // Notify listeners
        this.listeners.forEach(listener => {
          try {
            listener(networkInfo);
          } catch (error) {
            console.warn('NetworkUtils: Error in network state listener:', error);
          }
        });
      });
      
      this.isInitialized = true;
    } catch (error) {
      console.warn('NetworkUtils: Failed to initialize network monitoring:', error);
      // Fallback to unknown state
      this.currentNetworkInfo = {
        isConnected: true, // Assume connected if we can't detect
        connectionType: NetworkConnectionType.UNKNOWN,
        quality: NetworkQuality.UNKNOWN,
        isExpensive: false
      };
    }
  }
  
  /**
   * Get current network information
   */
  static getCurrentNetworkInfo(): NetworkInfo {
    if (!this.currentNetworkInfo) {
      // Return default if not initialized
      return {
        isConnected: true,
        connectionType: NetworkConnectionType.UNKNOWN,
        quality: NetworkQuality.UNKNOWN,
        isExpensive: false
      };
    }
    
    return this.currentNetworkInfo;
  }
  
  /**
   * Add network state change listener
   */
  static addNetworkListener(listener: (info: NetworkInfo) => void): () => void {
    this.listeners.push(listener);
    
    // Return unsubscribe function
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }
  
  /**
   * Parse NetInfo state to our NetworkInfo format
   */
  private static parseNetInfoState(state: NetInfoState): NetworkInfo {
    const connectionType = this.mapConnectionType(state.type);
    const quality = this.assessNetworkQuality(state);
    
    return {
      isConnected: state.isConnected ?? false,
      connectionType,
      quality,
      isExpensive: this.isExpensiveConnection(connectionType, state),
      strength: this.getSignalStrength(state)
    };
  }
  
  /**
   * Map NetInfo connection type to our enum
   */
  private static mapConnectionType(type: string): NetworkConnectionType {
    switch (type.toLowerCase()) {
      case 'wifi':
        return NetworkConnectionType.WIFI;
      case 'cellular':
        return NetworkConnectionType.CELLULAR;
      case 'ethernet':
        return NetworkConnectionType.ETHERNET;
      case 'bluetooth':
        return NetworkConnectionType.BLUETOOTH;
      case 'vpn':
        return NetworkConnectionType.VPN;
      case 'other':
        return NetworkConnectionType.OTHER;
      case 'none':
        return NetworkConnectionType.NONE;
      default:
        return NetworkConnectionType.UNKNOWN;
    }
  }
  
  /**
   * Assess network quality based on connection details
   */
  private static assessNetworkQuality(state: NetInfoState): NetworkQuality {
    if (!state.isConnected) {
      return NetworkQuality.UNKNOWN;
    }
    
    // WiFi quality assessment
    if (state.type === 'wifi' && state.details) {
      const wifiDetails = state.details as any;
      if (wifiDetails.strength !== undefined) {
        const strength = wifiDetails.strength;
        if (strength > 80) return NetworkQuality.EXCELLENT;
        if (strength > 60) return NetworkQuality.GOOD;
        if (strength > 40) return NetworkQuality.FAIR;
        return NetworkQuality.POOR;
      }
    }
    
    // Cellular quality assessment
    if (state.type === 'cellular' && state.details) {
      const cellularDetails = state.details as any;
      if (cellularDetails.cellularGeneration) {
        const generation = cellularDetails.cellularGeneration;
        if (generation === '5g') return NetworkQuality.EXCELLENT;
        if (generation === '4g') return NetworkQuality.GOOD;
        if (generation === '3g') return NetworkQuality.FAIR;
        return NetworkQuality.POOR;
      }
    }
    
    // Default quality based on connection type
    switch (state.type) {
      case 'wifi':
      case 'ethernet':
        return NetworkQuality.GOOD;
      case 'cellular':
        return NetworkQuality.FAIR;
      default:
        return NetworkQuality.UNKNOWN;
    }
  }
  
  /**
   * Determine if connection is expensive (cellular, metered)
   */
  private static isExpensiveConnection(type: NetworkConnectionType, state: NetInfoState): boolean {
    if (type === NetworkConnectionType.CELLULAR) {
      return true;
    }
    
    // Check if WiFi is metered
    if (type === NetworkConnectionType.WIFI && state.details) {
      const wifiDetails = state.details as any;
      return wifiDetails.isConnectionExpensive === true;
    }
    
    return false;
  }
  
  /**
   * Get signal strength (0-100)
   */
  private static getSignalStrength(state: NetInfoState): number | undefined {
    if (state.details) {
      const details = state.details as any;
      return details.strength;
    }
    return undefined;
  }
  
  /**
   * Check if network is suitable for telemetry upload
   */
  static isSuitableForUpload(): boolean {
    const info = this.getCurrentNetworkInfo();
    
    if (!info.isConnected) {
      return false;
    }
    
    // Always allow WiFi and Ethernet
    if (info.connectionType === NetworkConnectionType.WIFI || 
        info.connectionType === NetworkConnectionType.ETHERNET) {
      return true;
    }
    
    // For cellular, check quality
    if (info.connectionType === NetworkConnectionType.CELLULAR) {
      return info.quality !== NetworkQuality.POOR;
    }
    
    // Conservative for unknown connections
    return info.quality !== NetworkQuality.POOR;
  }
  
  /**
   * Get network attributes for telemetry
   */
  static getNetworkAttributes(): Record<string, string> {
    const info = this.getCurrentNetworkInfo();
    
    const attributes: Record<string, string> = {
      'network.connected': info.isConnected.toString(),
      'network.type': info.connectionType,
      'network.quality': info.quality,
      'network.expensive': info.isExpensive.toString()
    };
    
    if (info.strength !== undefined) {
      attributes['network.strength'] = info.strength.toString();
    }
    
    return attributes;
  }
}
