import { describe, it, expect, vi, afterEach } from "vitest";
import { NetworkTrackerNative } from "./interceptFetchNative.native";

// Native is XHR-only (#95): RN's global.fetch IS XMLHttpRequest underneath, so this suite
// drives requests the way the runtime does — through the XHR prototype — and asserts one
// http.request per call for a fetch-shaped caller and an axios-shaped one alike.
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

const g = global as any;
const saved = { XMLHttpRequest: g.XMLHttpRequest, fetch: g.fetch };
afterEach(() => { g.XMLHttpRequest = saved.XMLHttpRequest; g.fetch = saved.fetch; });

/** Minimal XHR double whose prototype the tracker patches; send() completes synchronously. */
function installFakeXHR(status: number, headers: Record<string, string> = {}) {
    function XHR(this: any) { this.status = status; this._l = {}; }
    XHR.prototype.open = function (this: any, m: string, u: string) { this._m = m; this._u = u; };
    XHR.prototype.send = function (this: any) { this._l["loadend"]?.(); };
    XHR.prototype.addEventListener = function (this: any, type: string, cb: any) { this._l[type] = cb; };
    XHR.prototype.getResponseHeader = function (k: string) { return headers[k.toLowerCase()] ?? null; };
    g.XMLHttpRequest = XHR;
    return XHR;
}

/** What RN's whatwg-fetch does: fetch() is a thin wrapper over `new XMLHttpRequest()`. */
function installXHRBackedFetch() {
    g.fetch = async (url: string, init?: any) => {
        const x = new g.XMLHttpRequest();
        x.open(init?.method ?? "GET", url);
        x.send(init?.body);
        return { status: x.status };
    };
}

describe("NetworkTrackerNative — XHR-only chokepoint (#95)", () => {
    it("emits exactly one http.request for a fetch call", async () => {
        installFakeXHR(200, { "content-length": "34" });
        installXHRBackedFetch();
        const { telemetry, calls } = fakeTelemetry();

        await new NetworkTrackerNative(telemetry).start();
        await g.fetch("https://api.example.com/v1/users/42", { method: "post", body: "hello" });

        expect(calls).toHaveLength(1);
        const { name, data } = calls[0];
        expect(name).toBe("http.request");
        expect(data["http.method"]).toBe("POST");
        expect(data["http.status_code"]).toBe(200);
        expect(data["http.success"]).toBe(true);
        expect(typeof data["http.duration_ms"]).toBe("number");
        expect(data["http.host"]).toBe("api.example.com");
        expect(data["http.route"]).toBe("/v1/users/{id}");
        expect(data["http.request_size"]).toBe(5);
        expect(data["http.response_size"]).toBe(34);
    });

    it("emits exactly one http.request for an axios-shaped raw XHR call", async () => {
        installFakeXHR(201);
        const { telemetry, calls } = fakeTelemetry();

        await new NetworkTrackerNative(telemetry).start();
        const x = new g.XMLHttpRequest();
        x.open("PUT", "https://api.example.com/orders/9/items");
        x.send('{"a":1}');

        expect(calls).toHaveLength(1);
        expect(calls[0].data["http.method"]).toBe("PUT");
        expect(calls[0].data["http.route"]).toBe("/orders/{id}/items");
        expect(calls[0].data["http.request_size"]).toBe(7);
        expect("http.response_size" in calls[0].data).toBe(false);   // no content-length
    });

    it("leaves global.fetch unpatched — patching both would double-count every call", async () => {
        installFakeXHR(200);
        installXHRBackedFetch();
        const beforeStart = g.fetch;
        const { telemetry } = fakeTelemetry();

        await new NetworkTrackerNative(telemetry).start();

        expect(g.fetch).toBe(beforeStart);
    });

    it("reports a transport failure as status 0, not a 5xx", async () => {
        installFakeXHR(0);
        const { telemetry, calls } = fakeTelemetry();

        await new NetworkTrackerNative(telemetry).start();
        const x = new g.XMLHttpRequest();
        x.open("GET", "https://api.example.com/v1/users");
        x.send();

        expect(calls[0].data["http.status_code"]).toBe(0);
        expect(calls[0].data["http.success"]).toBe(false);
    });

    it("omits http.host on a relative URL but still reports a route", async () => {
        installFakeXHR(200);
        const { telemetry, calls } = fakeTelemetry();

        await new NetworkTrackerNative(telemetry).start();
        const x = new g.XMLHttpRequest();
        x.open("GET", "/api/accounts/123");
        x.send();

        expect("http.host" in calls[0].data).toBe(false);
        expect(calls[0].data["http.route"]).toBe("/api/accounts/{id}");
    });

    it("never lets the collector endpoint reach an http.request", async () => {
        const endpoint = "https://collector.example.com/telemetry";
        installFakeXHR(200);
        installXHRBackedFetch();
        const { telemetry, calls } = fakeTelemetry(endpoint);

        await new NetworkTrackerNative(telemetry).start();
        await g.fetch(endpoint, { method: "POST", body: "{}" });

        expect(calls).toHaveLength(0);
        expect(JSON.stringify(calls)).not.toContain("collector.example.com");
    });

    it("stop() restores the original prototype", async () => {
        const XHR = installFakeXHR(200);
        const origSend = XHR.prototype.send;
        const { telemetry, calls } = fakeTelemetry();

        const tracker = new NetworkTrackerNative(telemetry);
        await tracker.start();
        tracker.stop();
        expect(XHR.prototype.send).toBe(origSend);

        const x = new g.XMLHttpRequest();
        x.open("GET", "https://api.example.com/x");
        x.send();
        expect(calls).toHaveLength(0);
    });
});
