import { describe, it, expect, vi, afterEach } from "vitest";
import { NetworkTrackerWeb } from "./interceptFetchWeb.web";

// Web fetch/XHR adapter must stay in lockstep with native on the v3 http.request contract (#25).
function fakeTelemetry(endpoint?: string) {
  const calls: Array<{ name: string; data: any }> = [];
  return {
    telemetry: {
      log: vi.fn((name: string, data?: any) => { calls.push({ name, data }); }),
      getEndpoint: () => endpoint,
    } as any,
    calls,
  };
}

function res(status: number, headers: Record<string, string> = {}) {
  return { status, headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } } as any;
}

const g = global as any;
const saved = { window: g.window, XMLHttpRequest: g.XMLHttpRequest };
afterEach(() => { g.window = saved.window; g.XMLHttpRequest = saved.XMLHttpRequest; });

// Minimal XHR double whose prototype the adapter patches.
function installFakeXHR(status: number, headers: Record<string, string> = {}) {
  function XHR(this: any) { this.status = status; this._l = {}; }
  XHR.prototype.open = function () { };
  XHR.prototype.send = function () { };
  XHR.prototype.addEventListener = function (type: string, cb: any) { this._l[type] = cb; };
  XHR.prototype.getResponseHeader = function (k: string) { return headers[k.toLowerCase()] ?? null; };
  g.XMLHttpRequest = XHR;
}

describe("NetworkTrackerWeb — http.request (v3)", () => {
  it("fetch emits http.request with baseline + additive attributes, not network_request", async () => {
    g.window = { fetch: vi.fn(async () => res(200, { "content-length": "34" })) };
    const { telemetry, calls } = fakeTelemetry();

    await new NetworkTrackerWeb(telemetry).start();
    await g.window.fetch("https://api.example.com/v1/users", { method: "POST", body: "hello" });

    expect(calls).toHaveLength(1);
    const { name, data } = calls[0];
    expect(name).toBe("http.request");
    expect(data["http.url"]).toBe("https://api.example.com/v1/users");
    expect(data["http.method"]).toBe("POST");
    expect(data["http.status_code"]).toBe(200);
    expect(data["http.success"]).toBe(true);
    expect(data["http.host"]).toBe("api.example.com");
    expect(data["http.path"]).toBe("/v1/users");
    expect(data["http.request_size"]).toBe(5);
    expect(data["http.response_size"]).toBe(34);
    expect(calls.some((c) => c.name === "network_request")).toBe(false);
  });

  it("does not self-capture the SDK's own collector POST", async () => {
    const endpoint = "https://collector.example.com/collector/telemetry";
    g.window = { fetch: vi.fn(async () => res(200)) };
    const { telemetry, calls } = fakeTelemetry(endpoint);

    await new NetworkTrackerWeb(telemetry).start();
    await g.window.fetch(endpoint, { method: "POST", body: "{}" });

    expect(calls).toHaveLength(0);
  });

  it("XHR emits http.request (lockstep with fetch)", async () => {
    g.window = { fetch: async () => res(200) };
    installFakeXHR(204, { "content-length": "0" });
    const { telemetry, calls } = fakeTelemetry();

    await new NetworkTrackerWeb(telemetry).start();

    const xhr: any = new g.XMLHttpRequest();
    xhr.open("GET", "https://api.example.com/ping");
    xhr.send();
    xhr._l.loadend();   // fire completion

    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("http.request");
    expect(calls[0].data["http.method"]).toBe("GET");
    expect(calls[0].data["http.status_code"]).toBe(204);
    expect(calls[0].data["http.success"]).toBe(true);
  });
});
