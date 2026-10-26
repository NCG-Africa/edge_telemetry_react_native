import { describe, it, expect, vi } from "vitest";
import { buildHeaders, isRejected, sendWithRetry } from "./batch";

describe("buildHeaders — the v4 dual-header credential (#90)", () => {
  it("sends the credential as both X-API-Key and Authorization: Bearer", () => {
    const h = buildHeaders("edge_id_secret");
    expect(h["X-API-Key"]).toBe("edge_id_secret");
    expect(h["Authorization"]).toBe("Bearer edge_id_secret");
    expect(h["Content-Type"]).toBe("application/json");
  });

  it("carries a JWT-shaped credential in both headers unchanged", () => {
    const jwt = "edge_eyJhbGciOiJSUzI1NiJ9.eyJ0ZW5hbnRfaWQiOiJ0MSJ9.sig";
    const h = buildHeaders(jwt);
    expect(h["X-API-Key"]).toBe(jwt);
    expect(h["Authorization"]).toBe(`Bearer ${jwt}`);
  });

  it("omits both auth headers when there is no credential", () => {
    const h = buildHeaders(undefined);
    expect(h["X-API-Key"]).toBeUndefined();
    expect(h["Authorization"]).toBeUndefined();
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
