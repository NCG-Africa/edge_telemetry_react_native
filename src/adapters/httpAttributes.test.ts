import { describe, it, expect } from "vitest";
import { buildHttpAttributes, normalizeRoute, utf8Bytes } from "./httpAttributes";

// The §4.4.1 normalization rule is the whole privacy posture of http.request: nothing raw
// leaves the device and the processor never re-derives, so the rule is tested verbatim.
describe("normalizeRoute — contract §4.4.1", () => {
    it("keeps the version carve-out: /v2/ survives the digit rule", () => {
        expect(normalizeRoute("/v1/users")).toBe("/v1/users");
        expect(normalizeRoute("/V2/users")).toBe("/V2/users");   // no case folding
        expect(normalizeRoute("/v10/users")).toBe("/v10/users");
        // "v1beta" is not /^v\d+$/ and does contain a digit → variable
        expect(normalizeRoute("/v1beta/users")).toBe("/{id}/users");
    });

    it("collapses any segment containing a digit", () => {
        expect(normalizeRoute("/users/123")).toBe("/users/{id}");
        expect(normalizeRoute("/users/u9/posts")).toBe("/users/{id}/posts");
        expect(normalizeRoute("/orders/3f2a-9c/items")).toBe("/orders/{id}/items");
    });

    it("collapses an opaque all-alpha token of 32+ chars", () => {
        const dashlessUuid = "aaaaaaaabbbbccccddddeeeeeeeeeeee";   // 32 chars, no digit
        expect(dashlessUuid).toHaveLength(32);
        expect(normalizeRoute(`/files/${dashlessUuid}`)).toBe("/files/{id}");
        expect(normalizeRoute(`/files/${dashlessUuid.slice(0, 31)}`)).toBe(`/files/${dashlessUuid.slice(0, 31)}`);
    });

    it("accepts the residue: an all-alpha slug survives as itself", () => {
        // /accounts/savings identifies one account and stays raw — guessing harder would
        // eat /settings/privacy.
        expect(normalizeRoute("/accounts/savings")).toBe("/accounts/savings");
        expect(normalizeRoute("/settings/privacy")).toBe("/settings/privacy");
    });

    it("caps depth at 6 segments and marks the truncation", () => {
        expect(normalizeRoute("/a/b/c/d/e/f")).toBe("/a/b/c/d/e/f");
        expect(normalizeRoute("/a/b/c/d/e/f/g")).toBe("/a/b/c/d/e/f/…");
        expect(normalizeRoute("/a/b/c/d/e/f/g/h/9")).toBe("/a/b/c/d/e/f/…");
    });

    it("keeps '/' as '/' and drops a trailing slash", () => {
        expect(normalizeRoute("/")).toBe("/");
        expect(normalizeRoute("")).toBe("/");
        expect(normalizeRoute("/users/")).toBe("/users");
        expect(normalizeRoute("//users//123/")).toBe("/users/{id}");
    });
});

describe("utf8Bytes", () => {
    it("counts bytes, not UTF-16 code units", () => {
        expect(utf8Bytes("hello")).toBe(5);
        expect(utf8Bytes("é")).toBe(2);
        expect(utf8Bytes("日本語")).toBe(9);
        expect(utf8Bytes("😀")).toBe(4);       // surrogate pair, not 2×3
        expect(utf8Bytes("\ud800")).toBe(3);   // lone surrogate → U+FFFD
    });

    it("agrees with TextEncoder wherever one exists", () => {
        const enc = new TextEncoder();
        for (const s of ["", "a", "héllo wörld", "日本語テスト", "a😀b", "\ud800x", "\udfff"]) {
            expect(utf8Bytes(s)).toBe(enc.encode(s).length);
        }
    });
});

describe("buildHttpAttributes — contract §4.4", () => {
    const base = { method: "get", statusCode: 200, durationMs: 12 };

    it("emits host + route and never http.url / http.path", () => {
        const a = buildHttpAttributes({ ...base, url: "https://api.example.com/v1/users/42?token=secret" });
        expect(a["http.host"]).toBe("api.example.com");
        expect(a["http.route"]).toBe("/v1/users/{id}");
        expect("http.url" in a).toBe(false);
        expect("http.path" in a).toBe(false);
        // the query string was never a key and is not smuggled into the route
        expect(JSON.stringify(a)).not.toContain("secret");
    });

    it("keeps the port on http.host", () => {
        const a = buildHttpAttributes({ ...base, url: "https://api.example.com:8443/v1/users" });
        expect(a["http.host"]).toBe("api.example.com:8443");
    });

    it("omits http.host for a native relative URL but still routes the path", () => {
        const a = buildHttpAttributes({ ...base, url: "/api/accounts/123?x=1" });
        expect("http.host" in a).toBe(false);
        expect(a["http.route"]).toBe("/api/accounts/{id}");
    });

    it("uppercases http.method", () => {
        expect(buildHttpAttributes({ ...base, url: "/x", method: "post" })["http.method"]).toBe("POST");
        expect(buildHttpAttributes({ ...base, url: "/x", method: "" })["http.method"]).toBe("GET");
    });

    it("reports status 0 as a failure without inventing a discriminator", () => {
        const a = buildHttpAttributes({ ...base, url: "/x", statusCode: 0, error: "Network error" });
        expect(a["http.status_code"]).toBe(0);
        expect(a["http.success"]).toBe(false);
        expect(Object.keys(a).some((k) => k.includes("error_kind"))).toBe(false);
    });

    it("measures every request body measurable without consuming it", () => {
        const size = (requestBody: unknown) =>
            buildHttpAttributes({ ...base, url: "/x", requestBody })["http.request_size"];

        expect(size("héllo")).toBe(6);                       // UTF-8 bytes, not 5 code units
        expect(size(new ArrayBuffer(16))).toBe(16);
        expect(size(new Uint8Array(9))).toBe(9);
        expect(size(new Uint32Array(4))).toBe(16);           // byteLength, not element count
        expect(size(new Blob(["abcd"]))).toBe(4);
    });

    it("omits http.request_size for FormData, streams and no body — never 0", () => {
        const size = (requestBody: unknown) =>
            buildHttpAttributes({ ...base, url: "/x", requestBody });

        expect("http.request_size" in size(new FormData())).toBe(false);
        expect("http.request_size" in size(undefined)).toBe(false);
        expect("http.request_size" in size(null)).toBe(false);
        expect("http.request_size" in size(new ReadableStream())).toBe(false);
        expect(size("")["http.request_size"]).toBe(0);       // an empty string body IS measured
    });

    it("ships a real response size of 0 but omits an unmeasurable one", () => {
        expect(buildHttpAttributes({ ...base, url: "/x", responseSize: 0 })["http.response_size"]).toBe(0);
        expect("http.response_size" in buildHttpAttributes({ ...base, url: "/x" })).toBe(false);
        expect("http.response_size" in buildHttpAttributes({ ...base, url: "/x", responseSize: NaN })).toBe(false);
    });
});
