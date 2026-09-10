import { describe, it, expect, vi, afterEach } from "vitest";
import type { TelemetryEvent } from "./core/telemetry";

// The wire IS the external behaviour (#95): drive the public API through createTelemetry({sender})
// and assert on the TelemetryEvent[] that reaches the injected Sender — keys, values and absence.
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  AppState: { currentState: "active", addEventListener: () => {} },
}));
vi.mock("react-native-device-info", () => ({
  default: {
    getApplicationName: async () => "NativeApp", getVersion: async () => "2.3.4",
    getBuildNumber: async () => "77", getBundleId: async () => "com.example.app",
    getBrand: async () => "Apple", getManufacturer: async () => "Apple",
    getModel: async () => "iPhone 15", getSystemVersion: async () => "17",
    getSystemName: async () => "iOS",
  },
}));
vi.mock("@react-native-community/netinfo", () => ({
  default: { fetch: async () => ({ type: "wifi", isConnected: true }), addEventListener: () => {} },
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

const g = global as any;
const saved = { XMLHttpRequest: g.XMLHttpRequest, fetch: g.fetch };
afterEach(() => {
  g.XMLHttpRequest = saved.XMLHttpRequest;
  g.fetch = saved.fetch;
  vi.restoreAllMocks();
});

function silenceConsole() {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
}

/** XHR double + the whatwg-fetch wrapper RN builds on top of it. Installed before init. */
function installRNHttp(status: number, headers: Record<string, string> = {}) {
  function XHR(this: any) { this.status = status; this._l = {}; }
  XHR.prototype.open = function () {};
  XHR.prototype.send = function (this: any) { this._l["loadend"]?.(); };
  XHR.prototype.addEventListener = function (this: any, t: string, cb: any) { this._l[t] = cb; };
  XHR.prototype.getResponseHeader = (k: string) => headers[k.toLowerCase()] ?? null;
  g.XMLHttpRequest = XHR;
  g.fetch = async (url: string, init?: any) => {
    const x = new g.XMLHttpRequest();
    x.open(init?.method ?? "GET", url);
    x.send(init?.body);
    return { status: x.status };
  };
}

// telemetry.log() is async and the XHR listener does not await it — give it a turn.
const tick = () => new Promise((r) => setTimeout(r, 0));

const ENDPOINT = "https://collector.example.com/telemetry";

async function makeTelemetry(sender: any) {
  const { createTelemetry } = await import("./createTelemetry.native");
  const t = createTelemetry({ apiKey: "edge_k", endpoint: ENDPOINT, sender, flushIntervalMs: 0 });
  // the ctor starts the network tracker fire-and-forget behind a dynamic import; let it land
  await t.flush();
  await tick();
  return t;
}

describe("native http.request on the wire (#95)", () => {
  it("ships one http.request per fetch call, with host + route and no raw URL", async () => {
    silenceConsole();
    installRNHttp(200, { "content-length": "34" });
    const sent: TelemetryEvent[] = [];
    const t = await makeTelemetry({ send: async (e: TelemetryEvent[]) => { sent.push(...e); } });

    await g.fetch("https://api.example.com/v1/accounts/GB29-NWBK-6016?token=abc", {
      method: "post", body: "héllo",
    });
    await tick();
    await t.flush();

    const http = sent.filter((e) => e.eventName === "http.request");
    expect(http).toHaveLength(1);
    const a = http[0].attributes!;
    expect(a["http.method"]).toBe("POST");
    expect(a["http.host"]).toBe("api.example.com");
    expect(a["http.route"]).toBe("/v1/accounts/{id}");
    expect(a["http.request_size"]).toBe(6);
    expect(a["http.response_size"]).toBe(34);
    expect("http.url" in a).toBe(false);
    expect("http.path" in a).toBe(false);
    // the account identifier and the token never leave the device at any SDK setting
    const wire = JSON.stringify(sent);
    expect(wire).not.toContain("GB29-NWBK-6016");
    expect(wire).not.toContain("token=abc");
  });

  it("never emits an http.request describing the collector endpoint", async () => {
    silenceConsole();
    installRNHttp(200);
    const sent: TelemetryEvent[] = [];
    // A real sender POSTs through the same patched XHR the SDK is watching.
    const sender = {
      send: async (e: TelemetryEvent[]) => {
        sent.push(...e);
        await g.fetch(ENDPOINT, { method: "POST", body: "{}" });
      },
    };
    const t = await makeTelemetry(sender);

    await g.fetch("https://api.example.com/v1/users", { method: "GET" });
    await tick();
    await t.flush();
    await tick();
    await t.flush();

    const http = sent.filter((e) => e.eventName === "http.request");
    expect(http).toHaveLength(1);
    expect(http[0].attributes!["http.host"]).toBe("api.example.com");
    expect(JSON.stringify(sent)).not.toContain("collector.example.com");
  });
});
