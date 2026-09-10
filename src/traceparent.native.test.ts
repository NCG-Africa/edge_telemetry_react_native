import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TelemetryEvent } from "./core/telemetry";
import { memoryStore } from "./core/memoryStore";
import type { Store } from "./core/store";

// #99 native mirror of traceparent.web.test.ts. The native build's only chokepoint is XHR
// (§4.4), so the consumer's header arrives through `setRequestHeader` and `skipped_no_cors`
// is unreachable by construction — `mode` is a fetch concept XHR cannot express.

const VALID = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
const API = "https://api.example.com/v2/accounts/91/balance";

const appState = vi.hoisted(() => {
  const listeners: Array<(s: string) => void> = [];
  return {
    currentState: "active",
    addEventListener: (_t: string, fn: (s: string) => void) => { listeners.push(fn); },
    emit(s: string) { appState.currentState = s; for (const fn of [...listeners]) fn(s); },
    listenerCount: () => listeners.length,
    reset() { listeners.length = 0; appState.currentState = "active"; },
  };
});
vi.mock("react-native", () => ({ Platform: { OS: "ios" }, AppState: appState }));
vi.mock("react-native-get-random-values", () => ({}));
vi.mock("react-native-device-info", () => ({
  default: new Proxy({}, { get: () => async () => "x" }),
}));
vi.mock("@react-native-community/netinfo", () => ({
  default: { fetch: async () => ({ type: "wifi", isConnected: true }), addEventListener: () => {} },
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

function silenceConsole() {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
}

const g = global as any;
const saved = { XMLHttpRequest: g.XMLHttpRequest, fetch: g.fetch };

/** Every request as the network saw it, headers included. */
const calls: Array<{ url: string; headers: Record<string, string> }> = [];

/** RN's XHR plus the whatwg-fetch wrapper over it — the single chokepoint the build patches. */
function installRNHttp() {
  function XHR(this: any) { this.status = 200; this._l = {}; this._h = {}; }
  XHR.prototype.open = function (this: any, m: string, u: string) { this._m = m; this._u = u; this._h = {}; };
  XHR.prototype.setRequestHeader = function (this: any, k: string, v: string) {
    this._h[String(k).toLowerCase()] = String(v);
  };
  XHR.prototype.send = function (this: any) {
    calls.push({ url: this._u, headers: { ...this._h } });
    (this._l["loadend"] || []).forEach((cb: any) => cb());
  };
  XHR.prototype.addEventListener = function (this: any, t: string, cb: any) {
    (this._l[t] = this._l[t] || []).push(cb);
  };
  XHR.prototype.getResponseHeader = () => null;
  g.XMLHttpRequest = XHR;
  g.fetch = async (url: string, init?: any) => {
    const x = new g.XMLHttpRequest();
    x.open(init?.method ?? "GET", url);
    for (const [k, v] of Object.entries(init?.headers ?? {})) x.setRequestHeader(k, v as string);
    x.send(init?.body);
    return { status: x.status };
  };
}

async function launch(opts: { traceHostAllowlist?: string[]; sessionSampleRate?: number } = {}, store: Store = memoryStore()) {
  const { createTelemetry } = await import("./createTelemetry.native");
  const sent: TelemetryEvent[] = [];
  const t = createTelemetry({
    apiKey: "edge_trace",
    endpoint: "https://collector/telemetry",
    sender: { send: async (e: TelemetryEvent[]) => { sent.push(...e); } },
    store,
    batchSize: 500,
    flushIntervalMs: 0,
    ...opts,
  });
  await settle();
  await vi.waitFor(() => expect(appState.listenerCount()).toBeGreaterThan(0));
  return { t, sent };
}

async function settle() {
  for (let i = 0; i < 200; i++) await Promise.resolve();
}

async function request(url = API, init?: any) {
  await g.fetch(url, init);
  await settle();
}

const lastHttp = (sent: TelemetryEvent[]) =>
  sent.filter((e) => e.eventName === "http.request").slice(-1)[0]?.attributes ?? {};
const lastCall = () => calls[calls.length - 1];

beforeEach(() => {
  silenceConsole();
  appState.reset();
  calls.length = 0;
  installRNHttp();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-14T10:00:00.000Z"));
  vi.stubGlobal("__DEV__", true);
});
afterEach(() => {
  g.XMLHttpRequest = saved.XMLHttpRequest;
  g.fetch = saved.fetch;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("#99 native — dark by default", () => {
  it("with the default (empty) allowlist no request carries a traceparent, and no outcome ships", async () => {
    const { t, sent } = await launch();
    await request();
    await t.flush();

    expect(lastCall().headers.traceparent).toBeUndefined();
    expect(lastHttp(sent)["traceparent.outcome"]).toBeUndefined();
    expect(lastHttp(sent)["trace.id"]).toMatch(/^[0-9a-f]{32}$/);   // local ids regardless
  });

  it("a malformed entry throws in dev and is dropped in production", async () => {
    await expect(launch({ traceHostAllowlist: ["*.example.com"] })).rejects.toThrow();

    vi.stubGlobal("__DEV__", false);
    const { t } = await launch({ traceHostAllowlist: ["api.example.com/v2", "api.example.com"] });
    await request();
    await t.flush();
    expect(lastCall().headers.traceparent).toBeDefined();   // the good entry survived
  });
});

describe("#99 native — the allowlist gate", () => {
  it("injects on an allowlisted host, carrying this row's own ids", async () => {
    const { t, sent } = await launch({ traceHostAllowlist: ["api.example.com"] });
    await request();
    await t.flush();

    const a = lastHttp(sent);
    expect(lastCall().headers.traceparent).toBe(`00-${a["trace.id"]}-${a["span.id"]}-01`);
    expect(String(a["traceparent.outcome"])).toMatch(/^injected_/);
  });

  it("ignores the port and folds punycode", async () => {
    const { t } = await launch({ traceHostAllowlist: ["api.example.com", "münchen.de"] });
    await request("https://api.example.com:8443/v2/x");
    expect(lastCall().headers.traceparent).toBeDefined();
    await request("https://xn--mnchen-3ya.de/api");
    expect(lastCall().headers.traceparent).toBeDefined();
    await t.flush();
  });

  it("skips a host off the allowlist and still stamps local ids", async () => {
    const { t, sent } = await launch({ traceHostAllowlist: ["api.example.com"] });
    await request("https://other.example.com/x");
    await t.flush();

    expect(lastCall().headers.traceparent).toBeUndefined();
    expect(lastHttp(sent)["traceparent.outcome"]).toBe("skipped_off_allowlist");
    expect(lastHttp(sent)["trace.id"]).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("#99 native — never-strip and read-scope", () => {
  it("adopts a valid consumer header, mirroring its ids and leaving it byte-identical", async () => {
    const { t, sent } = await launch({ traceHostAllowlist: ["api.example.com"] });
    await request(API, { headers: { TraceParent: VALID } });
    await t.flush();

    expect(lastCall().headers.traceparent).toBe(VALID);
    const a = lastHttp(sent);
    expect(a["traceparent.outcome"]).toBe("adopted");
    expect(a["trace.id"]).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(a["span.id"]).toBe("00f067aa0ba902b7");
    expect(a["parent.span.id"]).toBeUndefined();
  });

  it("skips a malformed consumer header rather than repairing it", async () => {
    const { t, sent } = await launch({ traceHostAllowlist: ["api.example.com"] });
    await request(API, { headers: { traceparent: "garbage" } });
    await t.flush();

    expect(lastCall().headers.traceparent).toBe("garbage");
    expect(lastHttp(sent)["traceparent.outcome"]).toBe("skipped_consumer_set");
  });

  it("writes traceparent and nothing else, and never retries", async () => {
    const { t } = await launch({ traceHostAllowlist: ["api.example.com"] });
    await request(API, { headers: { authorization: "Bearer x" } });
    await t.flush();

    expect(Object.keys(lastCall().headers).sort()).toEqual(["authorization", "traceparent"]);
    expect(calls.filter((c) => c.url === API)).toHaveLength(1);
  });

  it("a consumer's own retry gets a fresh span.id", async () => {
    const { t } = await launch({ traceHostAllowlist: ["api.example.com"] });
    await request();
    await request();
    await t.flush();
    const [first, second] = calls.filter((c) => c.url === API).map((c) => c.headers.traceparent);
    expect(first).toBeDefined();
    expect(second).not.toBe(first);
  });
});

describe("#99 native — the rest of the ladder", () => {
  it("reports the allowlist SIZE on session.started, and never the hosts", async () => {
    const { t, sent } = await launch({ traceHostAllowlist: ["api.example.com"] });
    await t.flush();
    const started = sent.find((e) => e.eventName === "session.started")!.attributes!;
    expect(started["sdk.trace_allowlist_size"]).toBe(1);
    expect(JSON.stringify(started)).not.toContain("api.example.com");
  });

  it("an unsampled session injects no header at all", async () => {
    const { t } = await launch({ traceHostAllowlist: ["api.example.com"], sessionSampleRate: 0 });
    await request();
    await t.flush();
    expect(lastCall().headers.traceparent).toBeUndefined();
  });

  it("reaches all three injected_* rungs, never skipped_no_cors, never injected_unwired", async () => {
    const { t, sent } = await launch({ traceHostAllowlist: ["api.example.com"] });

    await request();
    await t.flush();
    expect(lastHttp(sent)["traceparent.outcome"]).toBe("injected_attributed");

    vi.setSystemTime(Date.now() + 5000);
    await request();
    await t.flush();
    expect(lastHttp(sent)["traceparent.outcome"]).toBe("injected_expired");

    appState.emit("background");
    await settle();
    await request();
    await t.flush();
    expect(lastHttp(sent)["traceparent.outcome"]).toBe("injected_unattributed");

    const outcomes = sent.map((e) => e.attributes?.["traceparent.outcome"]);
    expect(outcomes).not.toContain("injected_unwired");
    // `mode` is a fetch concept XHR cannot express, so the rung needs no platform branch.
    expect(outcomes).not.toContain("skipped_no_cors");
  });
});
