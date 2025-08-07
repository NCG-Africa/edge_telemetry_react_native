import DeviceInfo from 'react-native-device-info';
import { Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import type { DeviceInfoCollector } from '../core/interfaces/DeviceInfoCollector';
import { DeviceIdManager } from '../managers/DeviceIdManager';

/**
 * ReactNativeDeviceInfoCollector
 * Collects device and app information using react-native-device-info
 * 
 * CRITICAL: Must produce IDENTICAL attributes to Flutter SDK for backend compatibility
 */
export class ReactNativeDeviceInfoCollector implements DeviceInfoCollector {
  private deviceIdManager: DeviceIdManager;

  constructor() {
    this.deviceIdManager = DeviceIdManager.getInstance();
  }

  /**
   * Collect comprehensive device information
   * Must match Flutter SDK attribute names and formats exactly
   */
  async collectDeviceInfo(): Promise<Record<string, string>> {
    const deviceAttributes: Record<string, string> = {};

    try {
      // Core device identification - must match Flutter exactly
      deviceAttributes['device.id'] = await this.deviceIdManager.getDeviceId();
      deviceAttributes['device.platform'] = Platform.OS.toLowerCase();
      
      // Device hardware information
      deviceAttributes['device.model'] = await DeviceInfo.getModel();
      deviceAttributes['device.manufacturer'] = await DeviceInfo.getManufacturer();
      deviceAttributes['device.brand'] = await DeviceInfo.getBrand();
      deviceAttributes['device.device_name'] = await DeviceInfo.getDeviceName();
      
      // System information
      deviceAttributes['device.system_name'] = DeviceInfo.getSystemName();
      deviceAttributes['device.system_version'] = DeviceInfo.getSystemVersion();
      
      // Hardware specifications
      deviceAttributes['device.total_memory'] = String(await DeviceInfo.getTotalMemory());
      deviceAttributes['device.used_memory'] = String(await DeviceInfo.getUsedMemory());
      deviceAttributes['device.total_disk_capacity'] = String(await DeviceInfo.getTotalDiskCapacity());
      deviceAttributes['device.free_disk_storage'] = String(await DeviceInfo.getFreeDiskStorage());
      
      // Device identifiers (when available)
      if (Platform.OS === 'ios') {
        deviceAttributes['device.ios_id_for_vendor'] = await DeviceInfo.getUniqueId();
      } else if (Platform.OS === 'android') {
        deviceAttributes['device.android_id'] = await DeviceInfo.getAndroidId();
      }
      
      // Screen information (using Dimensions API as fallback)
      try {
        const { Dimensions } = require('react-native');
        const { width, height } = Dimensions.get('window');
        deviceAttributes['device.screen_width'] = String(width);
        deviceAttributes['device.screen_height'] = String(height);
      } catch (error) {
        deviceAttributes['device.screen_width'] = 'unknown';
        deviceAttributes['device.screen_height'] = 'unknown';
      }
      
      // Network information
      const netInfo = await NetInfo.fetch();
      deviceAttributes['device.network_type'] = netInfo.type || 'unknown';
      deviceAttributes['device.is_connected'] = String(netInfo.isConnected || false);
      
      // Additional device characteristics
      deviceAttributes['device.is_emulator'] = String(await DeviceInfo.isEmulator());
      deviceAttributes['device.is_tablet'] = String(DeviceInfo.isTablet());
      deviceAttributes['device.has_notch'] = String(DeviceInfo.hasNotch());
      deviceAttributes['device.has_dynamic_island'] = String(DeviceInfo.hasDynamicIsland());
      
      // Battery information (if available)
      try {
        const batteryLevel = await DeviceInfo.getBatteryLevel();
        deviceAttributes['device.battery_level'] = String(Math.round(batteryLevel * 100));
      } catch (error) {
        // Battery info might not be available on all devices
        deviceAttributes['device.battery_level'] = 'unknown';
      }
      
      // Carrier information (if available)
      try {
        const carrier = await DeviceInfo.getCarrier();
        deviceAttributes['device.carrier'] = carrier || 'unknown';
      } catch (error) {
        deviceAttributes['device.carrier'] = 'unknown';
      }
      
    } catch (error) {
      console.warn('EdgeTelemetry: Error collecting device info:', error);
      // Ensure we always have basic platform info even if other collection fails
      deviceAttributes['device.platform'] = Platform.OS.toLowerCase();
      deviceAttributes['device.id'] = await this.deviceIdManager.getDeviceId();
    }

    return deviceAttributes;
  }

  /**
   * Collect application-specific information
   * Must match Flutter SDK app attribute names exactly
   */
  async collectAppInfo(): Promise<Record<string, string>> {
    const appAttributes: Record<string, string> = {};

    try {
      // Core app identification
      appAttributes['app.name'] = DeviceInfo.getApplicationName();
      appAttributes['app.bundle_id'] = DeviceInfo.getBundleId();
      appAttributes['app.version'] = DeviceInfo.getVersion();
      appAttributes['app.build_number'] = DeviceInfo.getBuildNumber();
      
      // App installation and update info
      appAttributes['app.first_install_time'] = String(await DeviceInfo.getFirstInstallTime());
      appAttributes['app.last_update_time'] = String(await DeviceInfo.getLastUpdateTime());
      
      // App state information
      appAttributes['app.is_debug'] = String(__DEV__);
      appAttributes['app.installer_package_name'] = await DeviceInfo.getInstallerPackageName() || 'unknown';
      
    } catch (error) {
      console.warn('EdgeTelemetry: Error collecting app info:', error);
      // Provide fallback values
      appAttributes['app.name'] = 'unknown';
      appAttributes['app.version'] = 'unknown';
      appAttributes['app.build_number'] = 'unknown';
    }

    return appAttributes;
  }

  /**
   * Get platform-specific attributes
   * iOS and Android specific information
   */
  async getPlatformAttributes(): Promise<Record<string, string>> {
    const platformAttributes: Record<string, string> = {};

    try {
      if (Platform.OS === 'ios') {
        // iOS specific attributes
        platformAttributes['ios.system_name'] = DeviceInfo.getSystemName();
        platformAttributes['ios.system_version'] = DeviceInfo.getSystemVersion();
        
        try {
          platformAttributes['ios.supported_abis'] = (await DeviceInfo.supportedAbis()).join(',');
        } catch (error) {
          platformAttributes['ios.supported_abis'] = 'unknown';
        }
        
      } else if (Platform.OS === 'android') {
        // Android specific attributes
        platformAttributes['android.system_name'] = DeviceInfo.getSystemName();
        platformAttributes['android.system_version'] = DeviceInfo.getSystemVersion();
        platformAttributes['android.api_level'] = String(await DeviceInfo.getApiLevel());
        
        try {
          platformAttributes['android.supported_abis'] = (await DeviceInfo.supportedAbis()).join(',');
          platformAttributes['android.supported_32bit_abis'] = (await DeviceInfo.supported32BitAbis()).join(',');
          platformAttributes['android.supported_64bit_abis'] = (await DeviceInfo.supported64BitAbis()).join(',');
        } catch (error) {
          platformAttributes['android.supported_abis'] = 'unknown';
        }
      }
      
    } catch (error) {
      console.warn('EdgeTelemetry: Error collecting platform-specific info:', error);
    }

    return platformAttributes;
  }

  /**
   * Collect all device information in one call
   * Combines device, app, and platform attributes
   */
  async collectAllDeviceInfo(): Promise<Record<string, string>> {
    const [deviceInfo, appInfo, platformInfo] = await Promise.all([
      this.collectDeviceInfo(),
      this.collectAppInfo(),
      this.getPlatformAttributes()
    ]);

    return {
      ...deviceInfo,
      ...appInfo,
      ...platformInfo,
    };
  }

  /**
   * Get a minimal set of device attributes for quick initialization
   * Used when full device info collection might be slow
   */
  async getMinimalDeviceInfo(): Promise<Record<string, string>> {
    try {
      return {
        'device.id': await this.deviceIdManager.getDeviceId(),
        'device.platform': Platform.OS.toLowerCase(),
        'device.model': await DeviceInfo.getModel(),
        'device.system_version': DeviceInfo.getSystemVersion(),
        'app.name': DeviceInfo.getApplicationName(),
        'app.version': DeviceInfo.getVersion(),
        'app.build_number': DeviceInfo.getBuildNumber(),
      };
    } catch (error) {
      console.warn('EdgeTelemetry: Error collecting minimal device info:', error);
      return {
        'device.id': await this.deviceIdManager.getDeviceId(),
        'device.platform': Platform.OS.toLowerCase(),
        'app.name': 'unknown',
        'app.version': 'unknown',
      };
    }
  }
}
