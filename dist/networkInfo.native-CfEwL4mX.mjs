import { useState as C, useEffect as H, useCallback as U } from "react";
import { NativeEventEmitter as A, Platform as M } from "react-native";
const E = {
  reachabilityUrl: "/",
  reachabilityMethod: "HEAD",
  reachabilityHeaders: {},
  reachabilityTest: (t) => Promise.resolve(t.status === 200),
  reachabilityShortTimeout: 5 * 1e3,
  // 5s
  reachabilityLongTimeout: 60 * 1e3,
  // 60s
  reachabilityRequestTimeout: 15 * 1e3,
  // 15s
  reachabilityShouldRun: () => !0,
  shouldFetchWiFiSSID: !0,
  useNativeReachability: !0
}, y = "netInfo.networkStatusDidChange";
let r;
(function(t) {
  t.unknown = "unknown", t.none = "none", t.cellular = "cellular", t.wifi = "wifi", t.bluetooth = "bluetooth", t.ethernet = "ethernet", t.wimax = "wimax", t.vpn = "vpn", t.other = "other";
})(r || (r = {}));
let f;
(function(t) {
  t["2g"] = "2g", t["3g"] = "3g", t["4g"] = "4g", t["5g"] = "5g";
})(f || (f = {}));
const v = typeof window < "u", u = v && !window.hasOwnProperty("tizen") && !window.hasOwnProperty("webOS") ? window.navigator.connection || window.navigator.mozConnection || window.navigator.webkitConnection : void 0, q = {
  bluetooth: r.bluetooth,
  cellular: r.cellular,
  ethernet: r.ethernet,
  none: r.none,
  other: r.other,
  unknown: r.unknown,
  wifi: r.wifi,
  wimax: r.wimax,
  mixed: r.other
}, F = {
  "2g": f["2g"],
  "3g": f["3g"],
  "4g": f["4g"],
  "slow-2g": f["2g"]
}, k = (t) => {
  const i = v ? navigator.onLine : !1, e = {
    isInternetReachable: null
  };
  if (!u)
    return i ? {
      ...e,
      isConnected: !0,
      type: r.other,
      details: {
        isConnectionExpensive: !1
      }
    } : {
      ...e,
      isConnected: !1,
      isInternetReachable: !1,
      type: r.none,
      details: null
    };
  const n = u.saveData, s = u.type ? q[u.type] : i ? r.other : r.unknown;
  return s === r.bluetooth ? {
    ...e,
    isConnected: !0,
    type: s,
    details: {
      isConnectionExpensive: n
    }
  } : s === r.cellular ? {
    ...e,
    isConnected: !0,
    type: s,
    details: {
      isConnectionExpensive: n,
      cellularGeneration: F[u.effectiveType] || null,
      carrier: null
    }
  } : s === r.ethernet ? {
    ...e,
    isConnected: !0,
    type: s,
    details: {
      isConnectionExpensive: n,
      ipAddress: null,
      subnet: null
    }
  } : s === r.wifi ? {
    ...e,
    isConnected: !0,
    type: s,
    details: {
      isConnectionExpensive: n,
      ssid: null,
      bssid: null,
      strength: null,
      ipAddress: null,
      subnet: null,
      frequency: null,
      linkSpeed: null,
      rxLinkSpeed: null,
      txLinkSpeed: null
    }
  } : s === r.wimax ? {
    ...e,
    isConnected: !0,
    type: s,
    details: {
      isConnectionExpensive: n
    }
  } : s === r.none ? {
    ...e,
    isConnected: !1,
    isInternetReachable: !1,
    type: s,
    details: null
  } : s === r.unknown ? {
    ...e,
    isConnected: i,
    isInternetReachable: null,
    type: s,
    details: null
  } : {
    ...e,
    isConnected: !0,
    type: r.other,
    details: {
      isConnectionExpensive: n
    }
  };
}, I = [], g = [], L = {
  addListener(t, i) {
    switch (t) {
      case y: {
        const e = () => {
          i(k());
        };
        u ? u.addEventListener("change", e) : v && (window.addEventListener("online", e, !1), window.addEventListener("offline", e, !1)), I.push(i), g.push(e);
        break;
      }
    }
  },
  removeListeners(t, i) {
    switch (t) {
      case y: {
        const e = I.indexOf(i), n = g[e];
        u ? u.removeEventListener("change", n) : v && (window.removeEventListener("online", n), window.removeEventListener("offline", n)), I.splice(e, 1), g.splice(e, 1);
        break;
      }
    }
  },
  async getCurrentState(t) {
    return k();
  },
  configure() {
  }
}, x = new A();
L.addListener(y, (t) => {
  x.emit(y, t);
});
const S = {
  ...L,
  eventEmitter: x
};
function l(t, i, e) {
  return i in t ? Object.defineProperty(t, i, { value: e, enumerable: !0, configurable: !0, writable: !0 }) : t[i] = e, t;
}
class V {
  constructor(i, e) {
    l(this, "_configuration", void 0), l(this, "_listener", void 0), l(this, "_isInternetReachable", void 0), l(this, "_currentInternetReachabilityCheckHandler", null), l(this, "_currentTimeoutHandle", null), l(this, "_setIsInternetReachable", (n) => {
      this._isInternetReachable !== n && (this._isInternetReachable = n, this._listener(this._isInternetReachable));
    }), l(this, "_setExpectsConnection", (n) => {
      this._currentInternetReachabilityCheckHandler !== null && (this._currentInternetReachabilityCheckHandler.cancel(), this._currentInternetReachabilityCheckHandler = null), this._currentTimeoutHandle !== null && (clearTimeout(this._currentTimeoutHandle), this._currentTimeoutHandle = null), n && this._configuration.reachabilityShouldRun() ? (this._isInternetReachable || this._setIsInternetReachable(null), this._currentInternetReachabilityCheckHandler = this._checkInternetReachability()) : this._setIsInternetReachable(!1);
    }), l(this, "_checkInternetReachability", () => {
      const n = new AbortController(), s = fetch(this._configuration.reachabilityUrl, {
        headers: this._configuration.reachabilityHeaders,
        method: this._configuration.reachabilityMethod,
        cache: "no-cache",
        signal: n.signal
      });
      let d;
      const c = new Promise((h, m) => {
        d = setTimeout(() => m("timedout"), this._configuration.reachabilityRequestTimeout);
      });
      let b = () => {
      };
      const w = new Promise((h, m) => {
        b = () => m("canceled");
      });
      return {
        promise: Promise.race([s, c, w]).then((h) => this._configuration.reachabilityTest(h)).then((h) => {
          this._setIsInternetReachable(h);
          const m = this._isInternetReachable ? this._configuration.reachabilityLongTimeout : this._configuration.reachabilityShortTimeout;
          this._currentTimeoutHandle = setTimeout(this._checkInternetReachability, m);
        }).catch((h) => {
          h === "canceled" ? n.abort() : (h === "timedout" && n.abort(), this._setIsInternetReachable(!1), this._currentTimeoutHandle = setTimeout(this._checkInternetReachability, this._configuration.reachabilityShortTimeout));
        }).then(() => {
          clearTimeout(d);
        }, (h) => {
          throw clearTimeout(d), h;
        }),
        cancel: b
      };
    }), l(this, "update", (n) => {
      typeof n.isInternetReachable == "boolean" && this._configuration.useNativeReachability ? this._setIsInternetReachable(n.isInternetReachable) : this._setExpectsConnection(n.isConnected);
    }), l(this, "currentState", () => this._isInternetReachable), l(this, "tearDown", () => {
      this._currentInternetReachabilityCheckHandler !== null && (this._currentInternetReachabilityCheckHandler.cancel(), this._currentInternetReachabilityCheckHandler = null), this._currentTimeoutHandle !== null && (clearTimeout(this._currentTimeoutHandle), this._currentTimeoutHandle = null);
    }), this._configuration = i, this._listener = e;
  }
}
function o(t, i, e) {
  return i in t ? Object.defineProperty(t, i, { value: e, enumerable: !0, configurable: !0, writable: !0 }) : t[i] = e, t;
}
class P {
  constructor(i) {
    o(this, "_nativeEventSubscription", null), o(this, "_subscriptions", /* @__PURE__ */ new Set()), o(this, "_latestState", null), o(this, "_internetReachability", void 0), o(this, "_handleNativeStateUpdate", (e) => {
      this._internetReachability.update(e);
      const n = this._convertState(e);
      this._latestState = n, this._subscriptions.forEach((s) => s(n));
    }), o(this, "_handleInternetReachabilityUpdate", (e) => {
      if (!this._latestState)
        return;
      const n = {
        ...this._latestState,
        isInternetReachable: e
      };
      this._latestState = n, this._subscriptions.forEach((s) => s(n));
    }), o(this, "_fetchCurrentState", async (e) => {
      const n = await S.getCurrentState(e);
      this._internetReachability.update(n);
      const s = this._convertState(n);
      return e || (this._latestState = s, this._subscriptions.forEach((d) => d(s))), s;
    }), o(this, "_convertState", (e) => typeof e.isInternetReachable == "boolean" ? e : {
      ...e,
      isInternetReachable: this._internetReachability.currentState()
    }), o(this, "latest", (e) => e ? this._fetchCurrentState(e) : this._latestState ? Promise.resolve(this._latestState) : this._fetchCurrentState()), o(this, "add", (e) => {
      this._subscriptions.add(e), this._latestState ? e(this._latestState) : this.latest().then(e);
    }), o(this, "remove", (e) => {
      this._subscriptions.delete(e);
    }), o(this, "tearDown", () => {
      this._internetReachability && this._internetReachability.tearDown(), this._nativeEventSubscription && this._nativeEventSubscription.remove(), this._subscriptions.clear();
    }), this._internetReachability = new V(i, this._handleInternetReachabilityUpdate), this._nativeEventSubscription = S.eventEmitter.addListener(y, this._handleNativeStateUpdate), this._fetchCurrentState();
  }
}
let N = E, a = null;
const p = () => new P(N);
let _ = !1, R = [];
function D(t) {
  N = {
    ...E,
    ...t
  }, a && (a.tearDown(), a = p()), M.OS === "ios" && S.configure(t);
}
function z(t) {
  return a || (a = p()), a.latest(t);
}
function W() {
  return a || (a = p()), _ ? new Promise((t) => {
    R.push(t);
  }) : (_ = !0, a._fetchCurrentState().then((t) => (R.forEach((i) => i(t)), R = [], t)).finally(() => {
    _ = !1;
  }));
}
function O(t) {
  return a || (a = p()), a.add(t), () => {
    a && a.remove(t);
  };
}
function $(t) {
  t && D(t);
  const [i, e] = C({
    type: r.unknown,
    isConnected: null,
    isInternetReachable: null,
    details: null
  });
  return H(() => {
    const n = O(e);
    return () => n();
  }, []), i;
}
function Q(t = !1, i) {
  const [e, n] = C(), [s, d] = C({
    type: r.unknown,
    isConnected: null,
    isInternetReachable: null,
    details: null
  });
  H(() => {
    if (t)
      return;
    const b = {
      ...E,
      ...i
    }, w = new P(b);
    return n(w), w.add(d), w.tearDown;
  }, [t, i]);
  const c = U(() => {
    e && !_ && (_ = !0, e._fetchCurrentState().finally(() => {
      _ = !1;
    }));
  }, [e]);
  return {
    netInfo: s,
    refresh: c
  };
}
const T = {
  configure: D,
  fetch: z,
  refresh: W,
  addEventListener: O,
  useNetInfo: $,
  useNetInfoInstance: Q
};
class J {
  // constructor(telemetry: Telemetry) {
  //     this.telemetry = telemetry;
  // }
  constructor() {
  }
  async collect() {
    console.log("network_info collecting");
    try {
      const i = await T.fetch();
      return {
        type: i.type,
        isConnected: i.isConnected ?? void 0
      };
    } catch {
      return { type: "unknown", isConnected: void 0 };
    }
  }
  /**
   * Collects and logs the current network state once.
   */
  async start(i) {
    this.telemetry = i;
    const e = await this.collect();
    return this.telemetry.log("network_info", e), e;
  }
  /**
   * Subscribe to changes and log them continuously.
   */
  subscribe(i) {
    this.telemetry = i, T.addEventListener((e) => {
      const n = {
        type: e.type,
        isConnected: e.isConnected ?? void 0,
        isInternetReachable: e.isInternetReachable ?? void 0
      };
      this.telemetry && this.telemetry.log("network_info_change", n);
    });
  }
}
export {
  J as NetworkInfoTrackerNative
};
//# sourceMappingURL=networkInfo.native-CfEwL4mX.mjs.map
