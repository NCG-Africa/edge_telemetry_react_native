import { describe, it, expect, vi } from "vitest";
import { buildBatch, buildHeaders, byIdentity, CONTRACT_VERSION, isRejected, sendWithRetry } from "./batch";
import type { TelemetryEvent } from "../core/telemetry";

// The identity the Context block stamps on every row; the envelope lifts it (#179, processor #29).
const identity = {
  "device.id": "device_1_abc_android",
  "device.platform": "android",
  "app.name": "Shop",
  "app.package_name": "com.example.shop",
  "app.version": "2.3.4",
  "app.build_number": "77",
  "sdk.platform": "react-native-android",
  "sdk.version": "5.0.0",
};
const row = (eventName: string, extra: Record<string, unknown> = {}): TelemetryEvent => ({
  type: "event", eventName, timestamp: "2026-01-01T00:00:00.000Z",
  attributes: { ...identity, "session.id": "s1", ...extra },
});

describe("buildBatch — the 8-key 4.x envelope (#179, processor #29)", () => {
  it("sends exactly the eight envelope keys, contract_version on the catalogue's 4.x", () => {
    const body = JSON.parse(buildBatch([row("view"), row("http.request")]));
    expect(Object.keys(body).sort()).toEqual(
      ["app", "batch_size", "contract_version", "device_id", "events", "sdk", "timestamp", "type"]);
    expect(body.type).toBe("telemetry_batch");
    expect(body.contract_version).toBe(CONTRACT_VERSION);
    expect(CONTRACT_VERSION.split(".")[0]).toBe("4");
    expect(body.batch_size).toBe(2);
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  });

  it("lifts identity to the root: device_id, sdk{name,version}, app{name,package_name,platform,version,build_number}", () => {
    const body = JSON.parse(buildBatch([row("view")]));
    expect(body.device_id).toBe("device_1_abc_android");
    expect(body.sdk).toEqual({ name: "react_native", version: "5.0.0" });
    expect(body.app).toEqual({
      name: "Shop", package_name: "com.example.shop", platform: "android", version: "2.3.4", build_number: "77",
    });
  });

  it("drops the per-event identity copies, and keeps everything else", () => {
    const [e] = JSON.parse(buildBatch([row("view", { "app.build_id": "b1" })])).events;
    for (const k of ["device.id", "app.name", "app.package_name", "app.version", "app.build_number", "sdk.platform", "sdk.version"]) {
      expect(Object.keys(e.attributes)).not.toContain(k);
    }
    // device.platform stays (it is a row key too); app.build_id is the symbolication key, not identity.
    expect(e.attributes["device.platform"]).toBe("android");
    expect(e.attributes["app.build_id"]).toBe("b1");
    expect(e.attributes["session.id"]).toBe("s1");
    expect(e.eventName).toBe("view");
  });

  it("does not mutate the queued events — a failed batch persists them with their identity", () => {
    const e = row("view");
    buildBatch([e]);
    expect(e.attributes!["device.id"]).toBe("device_1_abc_android");
  });

  it("byIdentity splits a replayed queue so a prior launch's rows ride that launch's app block", () => {
    const old = row("app.crash", { "app.version": "2.3.3" });
    const groups = byIdentity([old, row("view"), { ...old, eventName: "app.error" }]);
    expect(groups.map(g => g.map(e => e.eventName))).toEqual([["app.crash", "app.error"], ["view"]]);
  });
});

describe("buildHeaders — X-API-Key only (#179, processor #29)", () => {
  it("sends the credential as X-API-Key and no Authorization header", () => {
    const h = buildHeaders("edge_id_secret");
    expect(h["X-API-Key"]).toBe("edge_id_secret");
    expect(h["Authorization"]).toBeUndefined();
    expect(h["Content-Type"]).toBe("application/json");
  });

  it("carries a JWT-shaped credential unchanged", () => {
    const jwt = "edge_eyJhbGciOiJSUzI1NiJ9.eyJ0ZW5hbnRfaWQiOiJ0MSJ9.sig";
    expect(buildHeaders(jwt)["X-API-Key"]).toBe(jwt);
  });

  it("omits the auth header when there is no credential", () => {
    const h = buildHeaders(undefined);
    expect(h["X-API-Key"]).toBeUndefined();
    expect(h["Content-Type"]).toBe("application/json");
  });
});

describe("sendWithRetry — §2.5's status table (#162)", () => {
  const res = (status: number, headers: Record<string, string> = {}) =>
    ({ ok: status >= 200 && status < 300, status, headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } });
  const noWait = () => 0;

  it("a 4xx throws at once — one attempt, no retry", async () => {
    const post = vi.fn(async () => res(401));
    await expect(sendWithRetry(post, 3, noWait)).rejects.toMatchObject({ status: 401 });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("a 429 throws at once with X-RateLimit-Reset as epoch ms — seconds-from-now or epoch seconds", async () => {
    const now = Date.now();
    await expect(sendWithRetry(async () => res(429, { "x-ratelimit-reset": "30" }), 3, noWait))
      .rejects.toSatisfy((e: any) => e.status === 429 && e.resetAt >= now + 30_000 && e.resetAt < now + 31_000);
    const epoch = Math.floor(now / 1000) + 60;
    await expect(sendWithRetry(async () => res(429, { "x-ratelimit-reset": String(epoch) }), 3, noWait))
      .rejects.toMatchObject({ status: 429, resetAt: epoch * 1000 });
  });

  it("5xx and network errors retry, then throw the last error", async () => {
    const post = vi.fn(async () => res(503));
    await expect(sendWithRetry(post, 3, noWait)).rejects.toMatchObject({ status: 503 });
    expect(post).toHaveBeenCalledTimes(3);
    const flaky = vi.fn().mockRejectedValueOnce(new TypeError("offline")).mockResolvedValue(res(200));
    await expect(sendWithRetry(flaky, 3, noWait)).resolves.toBeUndefined();
  });

  it("isRejected is 4xx minus 429, read by shape so a consumer's sender can throw { status }", () => {
    expect(isRejected({ status: 400 })).toBe(true);
    expect(isRejected({ status: 429 })).toBe(false);
    expect(isRejected({ status: 500 })).toBe(false);
    expect(isRejected(new Error("x"))).toBe(false);
  });
});
