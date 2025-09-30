import { NativeEventEmitter as M, NativeModules as h, Platform as n, Dimensions as oe } from "react-native";
import { useState as p, useEffect as c, useMemo as re, useCallback as ae } from "react";
import { v as se } from "./v4-BysszJq8.mjs";
function g(o, r) {
  const [s, a] = p({
    loading: !0,
    result: r
  });
  return c(() => {
    (async () => {
      const i = await o();
      a({
        loading: !1,
        result: i
      });
    })();
  }, [o]), s;
}
const de = new M(h.RNDeviceInfo);
function v(o, r, s) {
  const {
    loading: a,
    result: d
  } = g(r, s), [i, y] = p(s);
  return c(() => {
    y(d);
  }, [d]), c(() => {
    const S = de.addListener(o, y);
    return () => S.remove();
  }, [o]), re(() => ({
    loading: a,
    result: i
  }), [a, i]);
}
const ie = [{
  brand: "Apple",
  model: "iPhone 16"
}, {
  brand: "Apple",
  model: "iPhone 16 Plus"
}, {
  brand: "Apple",
  model: "iPhone 16 Pro"
}, {
  brand: "Apple",
  model: "iPhone 16 Pro Max"
}, {
  brand: "Apple",
  model: "iPhone 15"
}, {
  brand: "Apple",
  model: "iPhone 15 Plus"
}, {
  brand: "Apple",
  model: "iPhone 15 Pro"
}, {
  brand: "Apple",
  model: "iPhone 15 Pro Max"
}, {
  brand: "Apple",
  model: "iPhone 14 Pro"
}, {
  brand: "Apple",
  model: "iPhone 14 Pro Max"
}], le = [{
  brand: "Apple",
  model: "iPhone 16"
}, {
  brand: "Apple",
  model: "iPhone 16 Plus"
}, {
  brand: "Apple",
  model: "iPhone 16 Pro"
}, {
  brand: "Apple",
  model: "iPhone 16 Pro Max"
}, {
  brand: "Apple",
  model: "iPhone 15"
}, {
  brand: "Apple",
  model: "iPhone 15 Plus"
}, {
  brand: "Apple",
  model: "iPhone 15 Pro"
}, {
  brand: "Apple",
  model: "iPhone 15 Pro Max"
}, {
  brand: "Apple",
  model: "iPhone 14"
}, {
  brand: "Apple",
  model: "iPhone 14 Plus"
}, {
  brand: "Apple",
  model: "iPhone 14 Pro"
}, {
  brand: "Apple",
  model: "iPhone 14 Pro Max"
}, {
  brand: "Apple",
  model: "iPhone 13 mini"
}, {
  brand: "Apple",
  model: "iPhone 13"
}, {
  brand: "Apple",
  model: "iPhone 13 Pro"
}, {
  brand: "Apple",
  model: "iPhone 13 Pro Max"
}, {
  brand: "Apple",
  model: "iPhone 12 mini"
}, {
  brand: "Apple",
  model: "iPhone 12"
}, {
  brand: "Apple",
  model: "iPhone 12 Pro"
}, {
  brand: "Apple",
  model: "iPhone 12 Pro Max"
}, {
  brand: "Apple",
  model: "iPhone 11"
}, {
  brand: "Apple",
  model: "iPhone 11 Pro"
}, {
  brand: "Apple",
  model: "iPhone 11 Pro Max"
}, {
  brand: "Apple",
  model: "iPhone X"
}, {
  brand: "Apple",
  model: "iPhone XS"
}, {
  brand: "Apple",
  model: "iPhone XS Max"
}, {
  brand: "Apple",
  model: "iPhone XR"
}, {
  brand: "Asus",
  model: "ZenFone 5"
}, {
  brand: "Asus",
  model: "ZenFone 5z"
}, {
  brand: "google",
  model: "Pixel 3 XL"
}, {
  brand: "google",
  model: "Pixel 4a"
}, {
  brand: "Huawei",
  model: "P20"
}, {
  brand: "Huawei",
  model: "P20 Plus"
}, {
  brand: "Huawei",
  model: "P20 Lite"
}, {
  brand: "Huawei",
  model: "ANE-LX1"
}, {
  brand: "Huawei",
  model: "INE-LX1"
}, {
  brand: "Huawei",
  model: "POT-LX1"
}, {
  brand: "Huawei",
  model: "Honor Play"
}, {
  brand: "Huawei",
  model: "Honor 10"
}, {
  brand: "Huawei",
  model: "Mate 20 Lite"
}, {
  brand: "Huawei",
  model: "Mate 20 Pro"
}, {
  brand: "Huawei",
  model: "ELE-L29"
  // P30
}, {
  brand: "Huawei",
  model: "P30 Lite"
}, {
  brand: "Huawei",
  model: "P30 Pro"
}, {
  brand: "Huawei",
  model: "JNY-LX1"
  // P40 Lite
}, {
  brand: "Huawei",
  model: "Nova 3"
}, {
  brand: "Huawei",
  model: "Nova 3i"
}, {
  brand: "Leagoo",
  model: "S9"
}, {
  brand: "LG",
  model: "G7"
}, {
  brand: "LG",
  model: "G7 ThinQ"
}, {
  brand: "LG",
  model: "G7+ ThinQ"
}, {
  brand: "LG",
  model: "LM-Q910"
  //G7 One
}, {
  brand: "LG",
  model: "LM-G710"
  //G7 ThinQ
}, {
  brand: "LG",
  model: "LM-V405"
  //V40 ThinQ
}, {
  brand: "Motorola",
  model: "Moto g7 Play"
}, {
  brand: "Motorola",
  model: "Moto g7 Power"
}, {
  brand: "Motorola",
  model: "One"
}, {
  brand: "Motorola",
  model: "Motorola One Vision"
}, {
  brand: "Nokia",
  model: "5.1 Plus"
}, {
  brand: "Nokia",
  model: "Nokia 6.1 Plus"
}, {
  brand: "Nokia",
  model: "7.1"
}, {
  brand: "Nokia",
  model: "8.1"
}, {
  brand: "OnePlus",
  model: "6"
}, {
  brand: "OnePlus",
  model: "A6003"
}, {
  brand: "ONEPLUS",
  model: "A6000"
}, {
  brand: "OnePlus",
  model: "OnePlus A6003"
}, {
  brand: "OnePlus",
  model: "ONEPLUS A6010"
}, {
  brand: "OnePlus",
  model: "ONEPLUS A6013"
}, {
  brand: "OnePlus",
  model: "ONEPLUS A6000"
}, {
  brand: "Oppo",
  model: "R15"
}, {
  brand: "Oppo",
  model: "R15 Pro"
}, {
  brand: "Oppo",
  model: "F7"
}, {
  brand: "Oukitel",
  model: "U18"
}, {
  brand: "Redmi",
  model: "M2004J19C"
}, {
  brand: "Sharp",
  model: "Aquos S3"
}, {
  brand: "Vivo",
  model: "V9"
}, {
  brand: "Vivo",
  model: "X21"
}, {
  brand: "Vivo",
  model: "X21 UD"
}, {
  brand: "xiaomi",
  model: "MI 8"
}, {
  brand: "xiaomi",
  model: "MI 8 Explorer Edition"
}, {
  brand: "xiaomi",
  model: "MI 8 SE"
}, {
  brand: "xiaomi",
  model: "MI 8 UD"
}, {
  brand: "xiaomi",
  model: "MI 8 Lite"
}, {
  brand: "xiaomi",
  model: "Mi 9"
}, {
  brand: "xiaomi",
  model: "POCO F1"
}, {
  brand: "xiaomi",
  model: "POCOPHONE F1"
}, {
  brand: "xiaomi",
  model: "Redmi 6 Pro"
}, {
  brand: "xiaomi",
  model: "Redmi Note 7"
}, {
  brand: "xiaomi",
  model: "Redmi 7"
}, {
  brand: "xiaomi",
  model: "Redmi Note 8"
}, {
  brand: "xiaomi",
  model: "Redmi Note 8 Pro"
}, {
  brand: "xiaomi",
  model: "Mi A2 Lite"
}, {
  brand: "Blackview",
  model: "A30"
}, {
  brand: "Samsung",
  model: "SM-A202F"
}, {
  brand: "Samsung",
  model: "SM-A217F"
}, {
  brand: "Samsung",
  model: "SM-A715F"
}];
let e = h.RNDeviceInfo;
(n.OS === "web" || n.OS === "dom") && (e = require("../web"));
if (!e && (n.OS === "android" || n.OS === "ios" || n.OS === "web" || // @ts-ignore
n.OS === "dom"))
  throw new Error("react-native-device-info: NativeModule.RNDeviceInfo is null. To fix this issue try these steps:\n  • For react-native <= 0.59: Run `react-native link react-native-device-info` in the project root.\n  • Rebuild and re-run the app.\n  • If you are using CocoaPods on iOS, run `pod install` in the `ios` directory and then rebuild and re-run the app. You may also need to re-open Xcode to get the new pods.\n  If none of these fix the issue, please open an issue on the Github repository: https://github.com/react-native-device-info/react-native-device-info");
let m = {};
function N(o, r, s) {
  let a = {};
  return o.filter((d) => n.OS == d).forEach((d) => a[d] = r), n.select({
    ...a,
    default: s
  });
}
function u({
  getter: o,
  supportedPlatforms: r,
  defaultValue: s,
  memoKey: a
}) {
  if (a && m[a] != null)
    return m[a];
  {
    const d = N(r, o, () => s)();
    return a && (m[a] = d), d;
  }
}
async function A({
  getter: o,
  supportedPlatforms: r,
  defaultValue: s,
  memoKey: a
}) {
  if (a && m[a] != null)
    return m[a];
  {
    const d = await N(r, o, () => Promise.resolve(s))();
    return a && (m[a] = d), d;
  }
}
function t({
  syncGetter: o,
  ...r
}) {
  return [() => A(r), () => u({
    ...r,
    getter: o
  })];
}
const [C, ue] = t({
  memoKey: "uniqueId",
  supportedPlatforms: ["android", "ios", "windows"],
  getter: () => e.getUniqueId(),
  syncGetter: () => e.getUniqueIdSync(),
  defaultValue: "unknown"
});
let w;
async function ce() {
  return n.OS === "ios" ? w = await e.syncUniqueId() : w = await C(), w;
}
const [me, pe] = t({
  memoKey: "instanceId",
  supportedPlatforms: ["android"],
  getter: () => e.getInstanceId(),
  syncGetter: () => e.getInstanceIdSync(),
  defaultValue: "unknown"
}), [ge, ye] = t({
  memoKey: "serialNumber",
  supportedPlatforms: ["android", "windows"],
  getter: () => e.getSerialNumber(),
  syncGetter: () => e.getSerialNumberSync(),
  defaultValue: "unknown"
}), [fe, Se] = t({
  memoKey: "androidId",
  supportedPlatforms: ["android"],
  getter: () => e.getAndroidId(),
  syncGetter: () => e.getAndroidIdSync(),
  defaultValue: "unknown"
}), [we, Pe] = t({
  supportedPlatforms: ["android", "ios", "windows"],
  getter: () => e.getIpAddress(),
  syncGetter: () => e.getIpAddressSync(),
  defaultValue: "unknown"
}), [be, he] = t({
  supportedPlatforms: ["android", "windows", "web"],
  getter: () => e.isCameraPresent(),
  syncGetter: () => e.isCameraPresentSync(),
  defaultValue: !1
});
async function ve() {
  return n.OS === "android" ? e.getMacAddress() : n.OS === "ios" ? "02:00:00:00:00:00" : "unknown";
}
function Ae() {
  return n.OS === "android" ? e.getMacAddressSync() : n.OS === "ios" ? "02:00:00:00:00:00" : "unknown";
}
const Ie = () => u({
  defaultValue: "unknown",
  memoKey: "deviceId",
  getter: () => e.deviceId,
  supportedPlatforms: ["android", "ios", "windows"]
}), [G, Ve] = t({
  memoKey: "manufacturer",
  supportedPlatforms: ["android", "ios", "windows"],
  getter: () => n.OS == "ios" ? Promise.resolve("Apple") : e.getSystemManufacturer(),
  syncGetter: () => n.OS == "ios" ? "Apple" : e.getSystemManufacturerSync(),
  defaultValue: "unknown"
}), I = () => u({
  memoKey: "model",
  defaultValue: "unknown",
  supportedPlatforms: ["ios", "android", "windows"],
  getter: () => e.model
}), V = () => u({
  memoKey: "brand",
  supportedPlatforms: ["android", "ios", "windows"],
  defaultValue: "unknown",
  getter: () => e.brand
}), ke = () => u({
  defaultValue: "unknown",
  supportedPlatforms: ["ios", "android", "windows"],
  memoKey: "systemName",
  getter: () => n.select({
    ios: e.systemName,
    android: "Android",
    windows: "Windows",
    default: "unknown"
  })
}), Oe = () => u({
  defaultValue: "unknown",
  getter: () => e.systemVersion,
  supportedPlatforms: ["android", "ios", "windows"],
  memoKey: "systemVersion"
}), [Le, Me] = t({
  memoKey: "buildId",
  supportedPlatforms: ["android", "ios", "windows"],
  getter: () => e.getBuildId(),
  syncGetter: () => e.getBuildIdSync(),
  defaultValue: "unknown"
}), [Ne, Ce] = t({
  memoKey: "apiLevel",
  supportedPlatforms: ["android"],
  getter: () => e.getApiLevel(),
  syncGetter: () => e.getApiLevelSync(),
  defaultValue: -1
}), Ge = () => u({
  memoKey: "bundleId",
  supportedPlatforms: ["android", "ios", "windows"],
  defaultValue: "unknown",
  getter: () => e.bundleId
}), [De, Be] = t({
  memoKey: "installerPackageName",
  supportedPlatforms: ["android", "windows", "ios"],
  getter: () => e.getInstallerPackageName(),
  syncGetter: () => e.getInstallerPackageNameSync(),
  defaultValue: "unknown"
}), He = () => u({
  memoKey: "appName",
  defaultValue: "unknown",
  getter: () => e.appName,
  supportedPlatforms: ["android", "ios", "windows"]
}), D = () => u({
  memoKey: "buildNumber",
  supportedPlatforms: ["android", "ios", "windows"],
  getter: () => e.buildNumber,
  defaultValue: "unknown"
}), B = () => u({
  memoKey: "version",
  defaultValue: "unknown",
  supportedPlatforms: ["android", "ios", "windows"],
  getter: () => e.appVersion
});
function Te() {
  return B() + "." + D();
}
const [H, Fe] = t({
  supportedPlatforms: ["android", "ios", "windows"],
  getter: () => e.getDeviceName(),
  syncGetter: () => e.getDeviceNameSync(),
  defaultValue: "unknown"
}), [Ke, xe] = t({
  supportedPlatforms: ["android", "ios", "windows", "web"],
  getter: () => e.getUsedMemory(),
  syncGetter: () => e.getUsedMemorySync(),
  defaultValue: -1
}), Re = () => A({
  memoKey: "userAgent",
  defaultValue: "unknown",
  supportedPlatforms: ["android", "ios", "web"],
  getter: () => e.getUserAgent()
}), Ee = () => u({
  memoKey: "userAgentSync",
  defaultValue: "unknown",
  supportedPlatforms: ["android", "web"],
  getter: () => e.getUserAgentSync()
}), [Ue, _e] = t({
  supportedPlatforms: ["android", "ios", "windows"],
  getter: () => e.getFontScale(),
  syncGetter: () => e.getFontScaleSync(),
  defaultValue: -1
}), [qe, Xe] = t({
  memoKey: "bootloader",
  supportedPlatforms: ["android"],
  getter: () => e.getBootloader(),
  syncGetter: () => e.getBootloaderSync(),
  defaultValue: "unknown"
}), [We, Ze] = t({
  getter: () => e.getDevice(),
  syncGetter: () => e.getDeviceSync(),
  defaultValue: "unknown",
  memoKey: "device",
  supportedPlatforms: ["android"]
}), [$e, Qe] = t({
  memoKey: "display",
  supportedPlatforms: ["android"],
  getter: () => e.getDisplay(),
  syncGetter: () => e.getDisplaySync(),
  defaultValue: "unknown"
}), [ze, Je] = t({
  memoKey: "fingerprint",
  supportedPlatforms: ["android"],
  getter: () => e.getFingerprint(),
  syncGetter: () => e.getFingerprintSync(),
  defaultValue: "unknown"
}), [Ye, je] = t({
  memoKey: "hardware",
  supportedPlatforms: ["android"],
  getter: () => e.getHardware(),
  syncGetter: () => e.getHardwareSync(),
  defaultValue: "unknown"
}), [et, tt] = t({
  memoKey: "host",
  supportedPlatforms: ["android", "windows"],
  getter: () => e.getHost(),
  syncGetter: () => e.getHostSync(),
  defaultValue: "unknown"
}), [nt, ot] = t({
  memoKey: "hostNames",
  supportedPlatforms: ["windows"],
  getter: () => e.getHostNames(),
  syncGetter: () => e.getHostNamesSync(),
  defaultValue: []
}), [rt, at] = t({
  memoKey: "product",
  supportedPlatforms: ["android"],
  getter: () => e.getProduct(),
  syncGetter: () => e.getProductSync(),
  defaultValue: "unknown"
}), [st, dt] = t({
  memoKey: "tags",
  supportedPlatforms: ["android"],
  getter: () => e.getTags(),
  syncGetter: () => e.getTagsSync(),
  defaultValue: "unknown"
}), [it, lt] = t({
  memoKey: "type",
  supportedPlatforms: ["android"],
  getter: () => e.getType(),
  syncGetter: () => e.getTypeSync(),
  defaultValue: "unknown"
}), [ut, ct] = t({
  memoKey: "baseOs",
  supportedPlatforms: ["android", "web", "windows"],
  getter: () => e.getBaseOs(),
  syncGetter: () => e.getBaseOsSync(),
  defaultValue: "unknown"
}), [mt, pt] = t({
  memoKey: "previewSdkInt",
  supportedPlatforms: ["android"],
  getter: () => e.getPreviewSdkInt(),
  syncGetter: () => e.getPreviewSdkIntSync(),
  defaultValue: -1
}), [gt, yt] = t({
  memoKey: "securityPatch",
  supportedPlatforms: ["android"],
  getter: () => e.getSecurityPatch(),
  syncGetter: () => e.getSecurityPatchSync(),
  defaultValue: "unknown"
}), [ft, St] = t({
  memoKey: "codeName",
  supportedPlatforms: ["android"],
  getter: () => e.getCodename(),
  syncGetter: () => e.getCodenameSync(),
  defaultValue: "unknown"
}), [wt, Pt] = t({
  memoKey: "incremental",
  supportedPlatforms: ["android"],
  getter: () => e.getIncremental(),
  syncGetter: () => e.getIncrementalSync(),
  defaultValue: "unknown"
}), [T, bt] = t({
  memoKey: "emulator",
  supportedPlatforms: ["android", "ios", "windows"],
  getter: () => e.isEmulator(),
  syncGetter: () => e.isEmulatorSync(),
  defaultValue: !1
}), ht = () => u({
  defaultValue: !1,
  supportedPlatforms: ["android", "ios", "windows"],
  memoKey: "tablet",
  getter: () => e.isTablet
}), vt = () => u({
  defaultValue: !1,
  supportedPlatforms: ["android"],
  memoKey: "lowRam",
  getter: () => e.isLowRamDevice
}), At = () => u({
  defaultValue: !1,
  supportedPlatforms: ["ios"],
  memoKey: "zoomed",
  getter: () => e.isDisplayZoomed
}), [It, Vt] = t({
  supportedPlatforms: ["android", "ios", "windows"],
  getter: () => e.isPinOrFingerprintSet(),
  syncGetter: () => e.isPinOrFingerprintSetSync(),
  defaultValue: !1
});
let P;
function kt() {
  if (P === void 0) {
    let o = V(), r = I();
    P = le.findIndex((s) => s.brand.toLowerCase() === o.toLowerCase() && s.model.toLowerCase() === r.toLowerCase()) !== -1;
  }
  return P;
}
let b;
function Ot() {
  if (b === void 0) {
    let o = V(), r = I();
    b = ie.findIndex((s) => s.brand.toLowerCase() === o.toLowerCase() && s.model.toLowerCase() === r.toLowerCase()) !== -1;
  }
  return b;
}
const [Lt, Mt] = t({
  supportedPlatforms: ["android"],
  getter: () => e.hasGms(),
  syncGetter: () => e.hasGmsSync(),
  defaultValue: !1
}), [Nt, Ct] = t({
  supportedPlatforms: ["android"],
  getter: () => e.hasHms(),
  syncGetter: () => e.hasHmsSync(),
  defaultValue: !1
}), [F, Gt] = t({
  memoKey: "firstInstallTime",
  supportedPlatforms: ["android", "ios", "windows"],
  getter: () => e.getFirstInstallTime(),
  syncGetter: () => e.getFirstInstallTimeSync(),
  defaultValue: -1
}), [Dt, Bt] = t({
  memoKey: "installReferrer",
  supportedPlatforms: ["android", "windows", "web"],
  getter: () => e.getInstallReferrer(),
  syncGetter: () => e.getInstallReferrerSync(),
  defaultValue: "unknown"
}), [Ht, Tt] = t({
  memoKey: "lastUpdateTime",
  supportedPlatforms: ["android"],
  getter: () => e.getLastUpdateTime(),
  syncGetter: () => e.getLastUpdateTimeSync(),
  defaultValue: -1
}), [Ft, Kt] = t({
  supportedPlatforms: ["android", "ios"],
  getter: () => e.getCarrier(),
  syncGetter: () => e.getCarrierSync(),
  defaultValue: "unknown"
}), [xt, Rt] = t({
  memoKey: "totalMemory",
  supportedPlatforms: ["android", "ios", "windows", "web"],
  getter: () => e.getTotalMemory(),
  syncGetter: () => e.getTotalMemorySync(),
  defaultValue: -1
}), [Et, Ut] = t({
  memoKey: "maxMemory",
  supportedPlatforms: ["android", "windows", "web"],
  getter: () => e.getMaxMemory(),
  syncGetter: () => e.getMaxMemorySync(),
  defaultValue: -1
}), [K, x] = t({
  supportedPlatforms: ["android", "ios", "windows", "web"],
  getter: () => e.getTotalDiskCapacity(),
  syncGetter: () => e.getTotalDiskCapacitySync(),
  defaultValue: -1
});
async function _t() {
  return n.OS === "android" ? e.getTotalDiskCapacityOld() : n.OS === "ios" || n.OS === "windows" || n.OS === "web" ? K() : -1;
}
function qt() {
  return n.OS === "android" ? e.getTotalDiskCapacityOldSync() : n.OS === "ios" || n.OS === "windows" || n.OS === "web" ? x() : -1;
}
const [R, E] = t({
  supportedPlatforms: ["android", "ios", "windows", "web"],
  getter: () => e.getFreeDiskStorage(),
  syncGetter: () => e.getFreeDiskStorageSync(),
  defaultValue: -1
});
async function Xt() {
  return n.OS === "android" ? e.getFreeDiskStorageOld() : n.OS === "ios" || n.OS === "windows" || n.OS === "web" ? R() : -1;
}
function Wt() {
  return n.OS === "android" ? e.getFreeDiskStorageOldSync() : n.OS === "ios" || n.OS === "windows" || n.OS === "web" ? E() : -1;
}
const [k, Zt] = t({
  supportedPlatforms: ["android", "ios", "windows", "web"],
  getter: () => e.getBatteryLevel(),
  syncGetter: () => e.getBatteryLevelSync(),
  defaultValue: -1
}), [U, $t] = t({
  supportedPlatforms: ["ios", "android", "windows", "web"],
  getter: () => e.getPowerState(),
  syncGetter: () => e.getPowerStateSync(),
  defaultValue: {}
}), [Qt, zt] = t({
  supportedPlatforms: ["android", "ios", "windows", "web"],
  getter: () => e.isBatteryCharging(),
  syncGetter: () => e.isBatteryChargingSync(),
  defaultValue: !1
});
async function Jt() {
  return Promise.resolve(_());
}
function _() {
  const {
    height: o,
    width: r
  } = oe.get("window");
  return r >= o;
}
const [Yt, jt] = t({
  supportedPlatforms: ["android", "web"],
  getter: () => e.isAirplaneMode(),
  syncGetter: () => e.isAirplaneModeSync(),
  defaultValue: !1
}), en = () => u({
  memoKey: "deviceType",
  supportedPlatforms: ["android", "ios", "windows"],
  defaultValue: "unknown",
  getter: () => e.deviceType
}), [tn, nn] = t({
  memoKey: "_supportedAbis",
  supportedPlatforms: ["android", "ios", "windows"],
  getter: () => e.getSupportedAbis(),
  syncGetter: () => e.getSupportedAbisSync(),
  defaultValue: []
}), [on, rn] = t({
  memoKey: "_supported32BitAbis",
  supportedPlatforms: ["android"],
  getter: () => e.getSupported32BitAbis(),
  syncGetter: () => e.getSupported32BitAbisSync(),
  defaultValue: []
}), [an, sn] = t({
  memoKey: "_supported64BitAbis",
  supportedPlatforms: ["android"],
  getter: () => e.getSupported64BitAbis(),
  syncGetter: () => e.getSupported64BitAbisSync(),
  defaultValue: []
});
async function q(o) {
  return n.OS === "android" ? e.hasSystemFeature(o) : !1;
}
function dn(o) {
  return n.OS === "android" ? e.hasSystemFeatureSync(o) : !1;
}
function ln(o) {
  return n.OS === "android" ? o < 0.15 : o < 0.2;
}
const [un, cn] = t({
  supportedPlatforms: ["android"],
  getter: () => e.getSystemAvailableFeatures(),
  syncGetter: () => e.getSystemAvailableFeaturesSync(),
  defaultValue: []
}), [mn, pn] = t({
  supportedPlatforms: ["android", "ios", "web"],
  getter: () => e.isLocationEnabled(),
  syncGetter: () => e.isLocationEnabledSync(),
  defaultValue: !1
}), [X, gn] = t({
  supportedPlatforms: ["android", "ios"],
  getter: () => e.isHeadphonesConnected(),
  syncGetter: () => e.isHeadphonesConnectedSync(),
  defaultValue: !1
}), [W, yn] = t({
  supportedPlatforms: ["android", "ios"],
  getter: () => e.isWiredHeadphonesConnected(),
  syncGetter: () => e.isWiredHeadphonesConnectedSync(),
  defaultValue: !1
}), [Z, fn] = t({
  supportedPlatforms: ["android", "ios"],
  getter: () => e.isBluetoothHeadphonesConnected(),
  syncGetter: () => e.isBluetoothHeadphonesConnectedSync(),
  defaultValue: !1
}), [Sn, wn] = t({
  supportedPlatforms: ["windows"],
  getter: () => e.isMouseConnected(),
  syncGetter: () => e.isMouseConnectedSync(),
  defaultValue: !1
}), [Pn, bn] = t({
  supportedPlatforms: ["windows"],
  getter: () => e.isKeyboardConnected(),
  syncGetter: () => e.isKeyboardConnectedSync(),
  defaultValue: !1
}), [hn, vn] = t({
  supportedPlatforms: ["android"],
  getter: () => e.getSupportedMediaTypeList(),
  syncGetter: () => e.getSupportedMediaTypeListSync(),
  defaultValue: []
}), An = () => A({
  supportedPlatforms: ["windows"],
  getter: () => e.isTabletMode(),
  defaultValue: !1
}), [In, Vn] = t({
  supportedPlatforms: ["android", "ios"],
  getter: () => e.getAvailableLocationProviders(),
  syncGetter: () => e.getAvailableLocationProvidersSync(),
  defaultValue: {}
}), [$, kn] = t({
  supportedPlatforms: ["ios"],
  getter: () => e.getBrightness(),
  syncGetter: () => e.getBrightnessSync(),
  defaultValue: -1
});
async function On() {
  return n.OS === "ios" ? e.getDeviceToken() : "unknown";
}
const f = new M(h.RNDeviceInfo);
function Ln() {
  const [o, r] = p(null);
  return c(() => {
    const s = async () => {
      const i = await k();
      r(i);
    }, a = (i) => {
      r(i);
    };
    s();
    const d = f.addListener("RNDeviceInfo_batteryLevelDidChange", a);
    return () => d.remove();
  }, []), o;
}
function Mn() {
  const [o, r] = p(null);
  return c(() => {
    (async () => {
      const i = await k();
      ln(i) && r(i);
    })();
    const a = (i) => {
      r(i);
    }, d = f.addListener("RNDeviceInfo_batteryLevelIsLow", a);
    return () => d.remove();
  }, []), o;
}
function Nn() {
  const [o, r] = p({});
  return c(() => {
    const s = async () => {
      const i = await U();
      r(i);
    }, a = (i) => {
      r(i);
    };
    s();
    const d = f.addListener("RNDeviceInfo_powerStateDidChange", a);
    return () => d.remove();
  }, []), o;
}
function Cn() {
  return v("RNDeviceInfo_headphoneConnectionDidChange", X, !1);
}
function Gn() {
  return v("RNDeviceInfo_headphoneWiredConnectionDidChange", W, !1);
}
function Dn() {
  return v("RNDeviceInfo_headphoneBluetoothConnectionDidChange", Z, !1);
}
function Bn() {
  return g(F, -1);
}
function Hn() {
  return g(H, "unknown");
}
function Tn(o) {
  const r = ae(() => q(o), [o]);
  return g(r, !1);
}
function Fn() {
  return g(T, !1);
}
function Kn() {
  return g(G, "unknown");
}
function xn() {
  const [o, r] = p(null);
  return c(() => {
    const s = async () => {
      const i = await $();
      r(i);
    }, a = (i) => {
      r(i);
    };
    s();
    const d = f.addListener("RNDeviceInfo_brightnessDidChange", a);
    return () => d.remove();
  }, []), o;
}
const l = {
  getAndroidId: fe,
  getAndroidIdSync: Se,
  getApiLevel: Ne,
  getApiLevelSync: Ce,
  getApplicationName: He,
  getAvailableLocationProviders: In,
  getAvailableLocationProvidersSync: Vn,
  getBaseOs: ut,
  getBaseOsSync: ct,
  getBatteryLevel: k,
  getBatteryLevelSync: Zt,
  getBootloader: qe,
  getBootloaderSync: Xe,
  getBrand: V,
  getBuildId: Le,
  getBuildIdSync: Me,
  getBuildNumber: D,
  getBundleId: Ge,
  getCarrier: Ft,
  getCarrierSync: Kt,
  getCodename: ft,
  getCodenameSync: St,
  getDevice: We,
  getDeviceId: Ie,
  getDeviceName: H,
  getDeviceNameSync: Fe,
  getDeviceSync: Ze,
  getDeviceToken: On,
  getDeviceType: en,
  getDisplay: $e,
  getDisplaySync: Qe,
  getFingerprint: ze,
  getFingerprintSync: Je,
  getFirstInstallTime: F,
  getFirstInstallTimeSync: Gt,
  getFontScale: Ue,
  getFontScaleSync: _e,
  getFreeDiskStorage: R,
  getFreeDiskStorageOld: Xt,
  getFreeDiskStorageSync: E,
  getFreeDiskStorageOldSync: Wt,
  getHardware: Ye,
  getHardwareSync: je,
  getHost: et,
  getHostSync: tt,
  getHostNames: nt,
  getHostNamesSync: ot,
  getIncremental: wt,
  getIncrementalSync: Pt,
  getInstallerPackageName: De,
  getInstallerPackageNameSync: Be,
  getInstallReferrer: Dt,
  getInstallReferrerSync: Bt,
  getInstanceId: me,
  getInstanceIdSync: pe,
  getIpAddress: we,
  getIpAddressSync: Pe,
  getLastUpdateTime: Ht,
  getLastUpdateTimeSync: Tt,
  getMacAddress: ve,
  getMacAddressSync: Ae,
  getManufacturer: G,
  getManufacturerSync: Ve,
  getMaxMemory: Et,
  getMaxMemorySync: Ut,
  getModel: I,
  getPowerState: U,
  getPowerStateSync: $t,
  getPreviewSdkInt: mt,
  getPreviewSdkIntSync: pt,
  getProduct: rt,
  getProductSync: at,
  getReadableVersion: Te,
  getSecurityPatch: gt,
  getSecurityPatchSync: yt,
  getSerialNumber: ge,
  getSerialNumberSync: ye,
  getSystemAvailableFeatures: un,
  getSystemAvailableFeaturesSync: cn,
  getSystemName: ke,
  getSystemVersion: Oe,
  getTags: st,
  getTagsSync: dt,
  getTotalDiskCapacity: K,
  getTotalDiskCapacityOld: _t,
  getTotalDiskCapacitySync: x,
  getTotalDiskCapacityOldSync: qt,
  getTotalMemory: xt,
  getTotalMemorySync: Rt,
  getType: it,
  getTypeSync: lt,
  getUniqueId: C,
  getUniqueIdSync: ue,
  getUsedMemory: Ke,
  getUsedMemorySync: xe,
  getUserAgent: Re,
  getUserAgentSync: Ee,
  getVersion: B,
  getBrightness: $,
  getBrightnessSync: kn,
  hasGms: Lt,
  hasGmsSync: Mt,
  hasHms: Nt,
  hasHmsSync: Ct,
  hasNotch: kt,
  hasDynamicIsland: Ot,
  hasSystemFeature: q,
  hasSystemFeatureSync: dn,
  isAirplaneMode: Yt,
  isAirplaneModeSync: jt,
  isBatteryCharging: Qt,
  isBatteryChargingSync: zt,
  isCameraPresent: be,
  isCameraPresentSync: he,
  isEmulator: T,
  isEmulatorSync: bt,
  isHeadphonesConnected: X,
  isHeadphonesConnectedSync: gn,
  isWiredHeadphonesConnected: W,
  isWiredHeadphonesConnectedSync: yn,
  isBluetoothHeadphonesConnected: Z,
  isBluetoothHeadphonesConnectedSync: fn,
  isLandscape: Jt,
  isLandscapeSync: _,
  isLocationEnabled: mn,
  isLocationEnabledSync: pn,
  isPinOrFingerprintSet: It,
  isPinOrFingerprintSetSync: Vt,
  isMouseConnected: Sn,
  isMouseConnectedSync: wn,
  isKeyboardConnected: Pn,
  isKeyboardConnectedSync: bn,
  isTabletMode: An,
  isTablet: ht,
  isLowRamDevice: vt,
  isDisplayZoomed: At,
  supported32BitAbis: on,
  supported32BitAbisSync: rn,
  supported64BitAbis: an,
  supported64BitAbisSync: sn,
  supportedAbis: tn,
  supportedAbisSync: nn,
  syncUniqueId: ce,
  useBatteryLevel: Ln,
  useBatteryLevelIsLow: Mn,
  useDeviceName: Hn,
  useFirstInstallTime: Bn,
  useHasSystemFeature: Tn,
  useIsEmulator: Fn,
  usePowerState: Nn,
  useManufacturer: Kn,
  useIsHeadphonesConnected: Cn,
  useIsWiredHeadphonesConnected: Gn,
  useIsBluetoothHeadphonesConnected: Dn,
  useBrightness: xn,
  getSupportedMediaTypeList: hn,
  getSupportedMediaTypeListSync: vn
};
class qn {
  // private telemetry: Telemetry;
  // constructor(telemetry?: Telemetry) {
  //     this.telemetry = telemetry || new Telemetry();
  // }
  constructor() {
  }
  async collect() {
    let r = "";
    try {
      r = await l.getUniqueId();
    } catch {
      r = `device_${Date.now()}_${se()}_${n.OS}`;
    }
    const s = await l.getApplicationName() || "UnknownApp", a = await l.getVersion() || "0.0.0", d = await l.getBuildNumber() || "0", i = await l.getBundleId() || "unknown.package", y = await l.getBrand(), S = await l.getManufacturer() || "", Q = await l.getModel() || "", O = await l.getSystemVersion() || "", z = await l.getSystemName() || "", J = await l.getDeviceName() || "", L = n.OS === "android" ? await l.getApiLevel() : void 0, Y = n.OS === "android" ? await l.getFingerprint?.() : void 0, j = n.OS === "android" ? await l.getHardware?.() : void 0, ee = n.OS === "android" ? await l.getProduct?.() : void 0, te = n.OS === "ios" ? z : void 0, ne = n.OS === "ios" ? J : void 0;
    return {
      app: {
        name: s,
        version: a,
        buildNumber: d,
        packageName: i
      },
      device: {
        id: r,
        platform: n.OS,
        platformVersion: O,
        model: Q,
        manufacturer: S,
        brand: y,
        // Android fields
        androidSdk: L ? String(L) : void 0,
        androidRelease: n.OS === "android" ? O : void 0,
        fingerprint: Y,
        hardware: j,
        product: ee,
        // iOS fields
        iosSystemName: te,
        iosDeviceName: ne
      }
    };
  }
  /**
   * Collects and logs the device/app metadata.
   */
  async start(r) {
    const s = await this.collect();
    r.log("device_info", s);
  }
}
export {
  qn as DeviceInfoTrackerNative
};
//# sourceMappingURL=deviceInfo.native-DNjtk_Pt.mjs.map
