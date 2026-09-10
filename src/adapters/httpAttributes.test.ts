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

    it("resolves a relative URL against the page where there is one — §4.4 omits host on NATIVE", () => {
        const g = globalThis as any;
        g.location = { href: "https://app.example.com:8443/dashboard" };
        try {
            const a = buildHttpAttributes({ ...base, url: "/api/accounts/123" });
            expect(a["http.host"]).toBe("app.example.com:8443");
            expect(a["http.route"]).toBe("/api/accounts/{id}");
        } finally {
            delete g.location;
        }
    });

    it("uppercases http.method without inventing one", () => {
        expect(buildHttpAttributes({ ...base, url: "/x", method: "post" })["http.method"]).toBe("POST");
        expect(buildHttpAttributes({ ...base, url: "/x", method: "patch" })["http.method"]).toBe("PATCH");
        // §9.5 authorises a case change, not a fabricated verb — fetch's GET default belongs
        // to fetch's caller, where it is a real observation.
        expect(buildHttpAttributes({ ...base, url: "/x", method: "" })["http.method"]).toBe("");
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
        expect(size(new URLSearchParams({ a: "1", b: "é" }))).toBe(utf8Bytes("a=1&b=%C3%A9"));
    });

    it("leaves the body readable by the caller afterwards", async () => {
        const blob = new Blob(["abcd"]);
        const params = new URLSearchParams({ a: "1" });
        const buf = new Uint8Array([1, 2, 3]);

        buildHttpAttributes({ ...base, url: "/x", requestBody: blob });
        buildHttpAttributes({ ...base, url: "/x", requestBody: params });
        buildHttpAttributes({ ...base, url: "/x", requestBody: buf });

        // measuring must never consume — draining a consumer's body is the worse bug
        expect(await blob.text()).toBe("abcd");
        expect(params.toString()).toBe("a=1");
        expect(Array.from(buf)).toEqual([1, 2, 3]);
    });

    it("omits http.request_size for FormData, streams and no body — and never ships 0", () => {
        const attrs = (requestBody: unknown) =>
            buildHttpAttributes({ ...base, url: "/x", requestBody });

        expect("http.request_size" in attrs(new FormData())).toBe(false);
        expect("http.request_size" in attrs(undefined)).toBe(false);
        expect("http.request_size" in attrs(null)).toBe(false);
        expect("http.request_size" in attrs(new ReadableStream())).toBe(false);
        // §4.4's two null disciplines differ: request_size is "never 0", response_size ships one
        expect("http.request_size" in attrs("")).toBe(false);
        expect("http.request_size" in attrs(new ArrayBuffer(0))).toBe(false);
    });

    it("ships a real response size of 0 but omits an unmeasurable one", () => {
        expect(buildHttpAttributes({ ...base, url: "/x", responseSize: 0 })["http.response_size"]).toBe(0);
        expect("http.response_size" in buildHttpAttributes({ ...base, url: "/x" })).toBe(false);
        expect("http.response_size" in buildHttpAttributes({ ...base, url: "/x", responseSize: NaN })).toBe(false);
    });
});
