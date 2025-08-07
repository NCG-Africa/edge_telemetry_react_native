// Jest setup for EdgeTelemetry React Native SDK tests

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
  clear: jest.fn(() => Promise.resolve()),
}));

// Mock react-native-device-info
jest.mock('react-native-device-info', () => ({
  getModel: jest.fn(() => Promise.resolve('iPhone 14')),
  getManufacturer: jest.fn(() => Promise.resolve('Apple')),
  getBrand: jest.fn(() => Promise.resolve('Apple')),
  getDeviceName: jest.fn(() => Promise.resolve('Test Device')),
  getSystemName: jest.fn(() => 'iOS'),
  getSystemVersion: jest.fn(() => '17.0'),
  getTotalMemory: jest.fn(() => Promise.resolve(8000000000)),
  getUsedMemory: jest.fn(() => Promise.resolve(4000000000)),
  getTotalDiskCapacity: jest.fn(() => Promise.resolve(256000000000)),
  getFreeDiskStorage: jest.fn(() => Promise.resolve(128000000000)),
  getUniqueId: jest.fn(() => Promise.resolve('test-unique-id')),
  getAndroidId: jest.fn(() => Promise.resolve('test-android-id')),
  getDeviceWidth: jest.fn(() => Promise.resolve(375)),
  getDeviceHeight: jest.fn(() => Promise.resolve(812)),
  isEmulator: jest.fn(() => Promise.resolve(false)),
  isTablet: jest.fn(() => false),
  hasNotch: jest.fn(() => true),
  hasDynamicIsland: jest.fn(() => true),
  getBatteryLevel: jest.fn(() => Promise.resolve(0.85)),
  getCarrier: jest.fn(() => Promise.resolve('Test Carrier')),
  getApplicationName: jest.fn(() => 'Test App'),
  getBundleId: jest.fn(() => 'com.test.app'),
  getVersion: jest.fn(() => '1.0.0'),
  getBuildNumber: jest.fn(() => '1'),
  getFirstInstallTime: jest.fn(() => Promise.resolve(1704067200000)),
  getLastUpdateTime: jest.fn(() => Promise.resolve(1704067200000)),
  getInstallerPackageName: jest.fn(() => Promise.resolve('com.apple.testflight')),
  supportedAbis: jest.fn(() => Promise.resolve(['arm64'])),
  supported32BitAbis: jest.fn(() => Promise.resolve([])),
  supported64BitAbis: jest.fn(() => Promise.resolve(['arm64'])),
  getApiLevel: jest.fn(() => Promise.resolve(33)),
}));

// Mock @react-native-community/netinfo
jest.mock('@react-native-community/netinfo', () => ({
  fetch: jest.fn(() => Promise.resolve({
    type: 'wifi',
    isConnected: true,
  })),
}));

// Mock React Native Platform
jest.mock('react-native', () => ({
  Platform: {
    OS: 'ios',
  },
}));

// Mock OpenTelemetry
jest.mock('@opentelemetry/api', () => ({
  trace: {
    getTracer: jest.fn(() => ({
      startSpan: jest.fn(() => ({
        setAttribute: jest.fn(),
        setStatus: jest.fn(),
        end: jest.fn(),
      })),
    })),
    getActiveSpan: jest.fn(() => undefined),
  },
  SpanStatusCode: {
    OK: 1,
    ERROR: 2,
  },
  SpanKind: {
    INTERNAL: 0,
  },
}));

jest.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    shutdown: jest.fn(() => Promise.resolve()),
  })),
}));

jest.mock('@opentelemetry/auto-instrumentations-node', () => ({
  getNodeAutoInstrumentations: jest.fn(() => []),
}));

// Global test utilities
(global as any).__DEV__ = true;

// Mock global error handling
(global as any).ErrorUtils = {
  getGlobalHandler: jest.fn(() => null),
  setGlobalHandler: jest.fn(),
};

// Mock fetch for HTTP requests
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve({}),
  })
) as jest.Mock;
