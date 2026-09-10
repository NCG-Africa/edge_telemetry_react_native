import { describe, it, expect } from "vitest";
import { buildBatch, buildHeaders } from "./batch";

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

describe("buildBatch", () => {
  it("closes the envelope at the four contract fields", () => {
    const body = JSON.parse(buildBatch([]));
    expect(Object.keys(body).sort()).toEqual(["batch_size", "events", "timestamp", "type"]);
  });
});
