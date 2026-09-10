import { describe, it, expect, vi, afterEach } from "vitest";
import { NetworkTrackerWeb } from "./interceptFetchWeb.web";

// Web patches fetch AND XHR — browser fetch is native, not XHR-backed, so neither channel
// double-counts (§4.4). Both must land the same v4 http.request keys (#95).
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
  it("fetch emits http.request with the v4 keys, and never http.url / http.path", async () => {
    g.window = { fetch: vi.fn(async () => res(200, { "content-length": "34" })) };
    const { telemetry, calls } = fakeTelemetry();

    await new NetworkTrackerWeb(telemetry).start();
    await g.window.fetch("https://api.example.com/v1/users/42?token=secret", { method: "post", body: "héllo" });

    expect(calls).toHaveLength(1);
    const { name, data } = calls[0];
    expect(name).toBe("http.request");
    expect(data["http.method"]).toBe("POST");            // uppercased in the shared builder
    expect(data["http.status_code"]).toBe(200);
    expect(data["http.success"]).toBe(true);
    expect(data["http.host"]).toBe("api.example.com");
    expect(data["http.route"]).toBe("/v1/users/{id}");
    expect(data["http.request_size"]).toBe(6);           // UTF-8 bytes, not 5 code units
    expect(data["http.response_size"]).toBe(34);
    expect("http.url" in data).toBe(false);
    expect("http.path" in data).toBe(false);
    expect(JSON.stringify(data)).not.toContain("secret");
    expect(calls.some((c) => c.name === "network_request")).toBe(false);
  });

  it("does not modify the method of the request it forwards", async () => {
    const spy = vi.fn(async (_input: any, _init?: any) => res(200));
    g.window = { fetch: spy };
    const { telemetry, calls } = fakeTelemetry();

    await new NetworkTrackerWeb(telemetry).start();
    await g.window.fetch("https://api.example.com/x", { method: "post" });

    expect(spy.mock.calls[0][1]).toEqual({ method: "post" });
    expect(calls[0].data["http.method"]).toBe("POST");
  });

  it("does not self-capture the SDK's own collector POST", async () => {
    const endpoint = "https://collector.example.com/telemetry";
    g.window = { fetch: vi.fn(async () => res(200)) };
    const { telemetry, calls } = fakeTelemetry(endpoint);

    await new NetworkTrackerWeb(telemetry).start();
    await g.window.fetch(endpoint, { method: "POST", body: "{}" });

    expect(calls).toHaveLength(0);
    expect(JSON.stringify(calls)).not.toContain("collector.example.com");
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
    expect(calls[0].data["http.route"]).toBe("/ping");
    expect(calls[0].data["http.response_size"]).toBe(0);   // a real 0 ships
  });
});
