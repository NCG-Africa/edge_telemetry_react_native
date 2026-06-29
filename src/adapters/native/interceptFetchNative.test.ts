import { describe, it, expect, vi, afterEach } from "vitest";
import { NetworkTrackerNative } from "./interceptFetchNative.native";

// Drives a real fetch through the patched global and captures what the tracker
// hands to telemetry.log — the wire-contract boundary for #25 (http.request rename).
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

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

function res(status: number, headers: Record<string, string> = {}) {
  return { status, headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } } as any;
}

describe("NetworkTrackerNative — http.request (v3)", () => {
  it("emits http.request with the baseline attributes; not the legacy network_request", async () => {
    global.fetch = vi.fn(async () => res(200, { "content-length": "12" })) as any;
    const { telemetry, calls } = fakeTelemetry();

    const tracker = new NetworkTrackerNative(telemetry);
    await tracker.start();

    await global.fetch("https://api.example.com/users", { method: "POST", body: "hello" });

    expect(calls).toHaveLength(1);
    const { name, data } = calls[0];
    expect(name).toBe("http.request");
    expect(data["http.url"]).toBe("https://api.example.com/users");
    expect(data["http.method"]).toBe("POST");
    expect(data["http.status_code"]).toBe(200);
    expect(typeof data["http.duration_ms"]).toBe("number");
    expect(data["http.success"]).toBe(true);
    // legacy v2 keys gone
    expect(calls.some((c) => c.name === "network_request")).toBe(false);
  });

  it("adds iOS-parity http.* attributes when available (host, path, sizes)", async () => {
    global.fetch = vi.fn(async () => res(200, { "content-length": "34" })) as any;
    const { telemetry, calls } = fakeTelemetry();

    const tracker = new NetworkTrackerNative(telemetry);
    await tracker.start();

    await global.fetch("https://api.example.com/v1/users?q=1", { method: "POST", body: "hello" });

    const { data } = calls[0];
    expect(data["http.host"]).toBe("api.example.com");
    expect(data["http.path"]).toBe("/v1/users");
    expect(data["http.request_size"]).toBe(5);   // "hello"
    expect(data["http.response_size"]).toBe(34);
  });

  it("does not self-capture the SDK's own collector POST", async () => {
    const endpoint = "https://collector.example.com/collector/telemetry";
    global.fetch = vi.fn(async () => res(200)) as any;
    const { telemetry, calls } = fakeTelemetry(endpoint);

    const tracker = new NetworkTrackerNative(telemetry);
    await tracker.start();

    await global.fetch(endpoint, { method: "POST", body: "{}" });

    expect(calls).toHaveLength(0);
  });
});
