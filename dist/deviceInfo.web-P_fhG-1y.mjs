import { v as r } from "./v4-BysszJq8.mjs";
class t {
  constructor() {
  }
  async collect() {
    const e = navigator.userAgent;
    return {
      app: {
        name: document.title || "WebApp",
        version: process.env.APP_VERSION || "1.0.0",
        buildNumber: process.env.BUILD_NUMBER,
        packageName: window.location.hostname
      },
      device: {
        id: `device_${Date.now()}_${r()}_web`,
        platform: "web",
        platformVersion: navigator.appVersion,
        model: e,
        manufacturer: "browser",
        brand: navigator.vendor || "unknown",
        // Android placeholders
        androidSdk: void 0,
        androidRelease: void 0,
        fingerprint: void 0,
        hardware: void 0,
        product: void 0,
        // iOS placeholders
        iosSystemName: void 0,
        iosDeviceName: void 0
      }
    };
  }
  async start(e) {
    this.telemetry = e;
    const o = await this.collect();
    this.telemetry.log("device_info", o);
  }
}
export {
  t as DeviceInfoTrackerWeb
};
//# sourceMappingURL=deviceInfo.web-P_fhG-1y.mjs.map
