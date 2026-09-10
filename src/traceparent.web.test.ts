import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTelemetry } from "./createTelemetry.web";
import type { TelemetryEvent } from "./core/telemetry";
import { memoryStore } from "./core/memoryStore";

// #99 — distributed trace header injection, observed the only way that matters: the public
// API in, and out two wires — the `TelemetryEvent[]` reaching the injected Sender, and the
// `init` reaching the *original* `fetch`. Nothing reaches into TraceManager.

const VALID = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
const API = "https://api.example.com/v2/accounts/91/balance";

function silenceConsole() {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
}

const win: any = {};
const doc: any = {};

/** Every call the SDK forwarded to the real fetch, as the network would have seen it. */
const calls: Array<{ url: string; headers: Record<string, string>; init: any }> = [];
/** The unpatched fetch the SDK wraps — the network, as far as this test is concerned. */
let rawFetch: any;

function headersOf(init: any): Record<string, string> {
  const out: Record<string, string> = {};
  const h = init?.headers;
  if (Array.isArray(h)) for (const [k, v] of h) out[String(k).toLowerCase()] = String(v);
  else if (h) for (const [k, v] of Object.entries(h)) out[String(k).toLowerCase()] = String(v);
  return out;
}

function launch(opts: { traceHostAllowlist?: string[]; sessionSampleRate?: number } = {}) {
  const sent: TelemetryEvent[] = [];
  const t = createTelemetry({
    apiKey: "edge_trace",
    endpoint: "https://collector/telemetry",
    sender: { send: async (e: TelemetryEvent[]) => { sent.push(...e); } },
    store: memoryStore(),
    batchSize: 500,
    flushIntervalMs: 0,
    ...opts,
  });
  return { t, sent };
}

async function request(url = API, init?: any) {
  await win.fetch(url, init);
  await vi.advanceTimersByTimeAsync(0);
}

/** The trackers install fire-and-forget behind dynamic imports; drain rather than guess. */
/**
 * The trackers install fire-and-forget behind dynamic imports. Wait for the `fetch` patch
 * itself rather than guessing a microtask count — the first test in the file pays the module
 * load and every later one does not, which is exactly the flake a fixed count invites.
 */
async function settle() {
  await vi.waitFor(() => expect(win.fetch).not.toBe(rawFetch));
  for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(0);
}

/** The last `http.request` row the SDK enqueued. */
const lastHttp = (sent: TelemetryEvent[]) =>
  sent.filter((e) => e.eventName === "http.request").slice(-1)[0]?.attributes ?? {};
const lastCall = () => calls[calls.length - 1];

beforeEach(() => {
  silenceConsole();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-14T10:00:00.000Z"));
  calls.length = 0;

  win._listeners = {} as Record<string, ((e: any) => void)[]>;
  win.addEventListener = (type: string, fn: (e: any) => void) => {
    (win._listeners[type] ??= []).push(fn);
  };
  rawFetch = vi.fn(async (url: any, init: any) => {
    calls.push({ url: String(url), headers: headersOf(init), init });
    return { status: 200, headers: { get: () => null } };
  });
  win.fetch = rawFetch;

  doc._listeners = {} as Record<string, ((e: any) => void)[]>;
  doc.visibilityState = "visible";
  doc.addEventListener = (type: string, fn: (e: any) => void) => {
    (doc._listeners[type] ??= []).push(fn);
  };

  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("__DEV__", true);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("#99 dark by default", () => {
  it("with the default (empty) allowlist no request carries a traceparent, and no outcome ships", async () => {
    const { t, sent } = launch();
    await settle();
    await request();
    await t.flush();

    expect(lastCall().headers.traceparent).toBeUndefined();
    // Absent means not traced: a consumer who never opted in is not traced at all.
    expect(lastHttp(sent)["traceparent.outcome"]).toBeUndefined();
    // Local ids are stamped regardless — that never depended on the header (§6.5).
    expect(lastHttp(sent)["trace.id"]).toMatch(/^[0-9a-f]{32}$/);
  });

  it("a malformed entry throws in dev and is dropped in production", async () => {
    expect(() => launch({ traceHostAllowlist: ["https://api.example.com"] })).toThrow();

    vi.stubGlobal("__DEV__", false);
    const { t, sent } = launch({ traceHostAllowlist: ["api.example.com:443", "api.example.com"] });
    await settle();
    await request();
    await t.flush();
    expect(lastCall().headers.traceparent).toBeDefined();   // the good entry survived
  });
});

describe("#99 the allowlist gate", () => {
  it("injects on an allowlisted host, and the header carries this row's own ids", async () => {
    const { t, sent } = launch({ traceHostAllowlist: ["api.example.com"] });
    await settle();
    await request();
    await t.flush();

    const a = lastHttp(sent);
    expect(lastCall().headers.traceparent).toBe(`00-${a["trace.id"]}-${a["span.id"]}-01`);
    expect(String(a["traceparent.outcome"])).toMatch(/^injected_/);
  });

  it("matches the same host on a different port — ports are ignored", async () => {
    const { t, sent } = launch({ traceHostAllowlist: ["api.example.com"] });
    await settle();
    await request("https://api.example.com:8443/v2/x");
    await t.flush();
    expect(lastCall().headers.traceparent).toBeDefined();
  });

  it("matches a unicode host against its punycode entry", async () => {
    const { t } = launch({ traceHostAllowlist: ["xn--mnchen-3ya.de"] });
    await settle();
    await request("https://münchen.de/api");
    await t.flush();
    expect(lastCall().headers.traceparent).toBeDefined();
  });

  it("a host off the allowlist is skipped, and still stamps local ids", async () => {
    const { t, sent } = launch({ traceHostAllowlist: ["api.example.com"] });
    await settle();
    await request("https://other.example.com/x");
    await t.flush();

    expect(lastCall().headers.traceparent).toBeUndefined();
    expect(lastHttp(sent)["traceparent.outcome"]).toBe("skipped_off_allowlist");
    expect(lastHttp(sent)["trace.id"]).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("#99 never-strip and read-scope", () => {
  it("adopts a valid consumer header, mirroring its ids and leaving it byte-identical", async () => {
    const { t, sent } = launch({ traceHostAllowlist: ["api.example.com"] });
    await settle();
    await request(API, { headers: { TraceParent: VALID, authorization: "Bearer x" } });
    await t.flush();

    expect(lastCall().headers.traceparent).toBe(VALID);
    const a = lastHttp(sent);
    expect(a["traceparent.outcome"]).toBe("adopted");
    expect(a["trace.id"]).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(a["span.id"]).toBe("00f067aa0ba902b7");     // §6.1: mirrors the foreign parent-id
    expect(a["parent.span.id"]).toBeUndefined();       // omitted on adopted
  });

  it("skips a malformed consumer header rather than repairing it", async () => {
    const { t, sent } = launch({ traceHostAllowlist: ["api.example.com"] });
    await settle();
    await request(API, { headers: { traceparent: "garbage" } });
    await t.flush();

    expect(lastCall().headers.traceparent).toBe("garbage");   // left alone, not rewritten
    expect(lastHttp(sent)["traceparent.outcome"]).toBe("skipped_consumer_set");
  });

  it("writes traceparent and nothing else, and never mutates the consumer's own headers", async () => {
    const { t } = launch({ traceHostAllowlist: ["api.example.com"] });
    await settle();
    const mine = { authorization: "Bearer x" };
    await request(API, { headers: mine });
    await t.flush();

    expect(Object.keys(lastCall().headers).sort()).toEqual(["authorization", "traceparent"]);
    expect(mine).toEqual({ authorization: "Bearer x" });     // the consumer's object is untouched
  });

  it("does not retry, so a request is never retried without the header", async () => {
    const { t } = launch({ traceHostAllowlist: ["api.example.com"] });
    await settle();
    await request();
    await t.flush();
    expect(calls.filter((c) => c.url === API)).toHaveLength(1);
  });

  it("a consumer's own retry gets a fresh span.id — each attempt is its own span", async () => {
    const { t, sent } = launch({ traceHostAllowlist: ["api.example.com"] });
    await settle();
    await request();
    await request();
    await t.flush();

    const [first, second] = calls.filter((c) => c.url === API).map((c) => c.headers.traceparent);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
  });
});

describe("#99 what else the SDK does at runtime — nothing", () => {
  it("reports the allowlist SIZE on session.started, and never the hosts", async () => {
    const { t, sent } = launch({ traceHostAllowlist: ["api.example.com", "cdn.example.com"] });
    await settle();
    await t.flush();

    const started = sent.find((e) => e.eventName === "session.started")!.attributes!;
    expect(started["sdk.trace_allowlist_size"]).toBe(2);
    expect(JSON.stringify(started)).not.toContain("api.example.com");

    const off = launch();
    await settle();
    await off.t.flush();
    expect(off.sent.find((e) => e.eventName === "session.started")!
      .attributes!["sdk.trace_allowlist_size"]).toBe(0);
  });

  it("carries a Request's referrer across, since a non-empty init would reset it", async () => {
    const { t } = launch({ traceHostAllowlist: ["api.example.com"] });
    await settle();
    const req: any = { referrer: "https://app.example.com/checkout", referrerPolicy: "origin",
                       headers: {}, toString: () => API };
    await win.fetch(req);            // no init at all — the case where the reset would bite
    await vi.advanceTimersByTimeAsync(0);
    await t.flush();

    expect(lastCall().headers.traceparent).toBeDefined();
    expect(lastCall().init.referrer).toBe("https://app.example.com/checkout");
    expect(lastCall().init.referrerPolicy).toBe("origin");
  });
});

describe("#99 the rest of the ladder", () => {
  it("skipped_no_cors is fetch-only and outranks a consumer header", async () => {
    const { t, sent } = launch({ traceHostAllowlist: ["api.example.com"] });
    await settle();
    await request(API, { mode: "no-cors", headers: { traceparent: VALID } });
    await t.flush();

    expect(lastHttp(sent)["traceparent.outcome"]).toBe("skipped_no_cors");
    expect(lastCall().headers.traceparent).toBe(VALID);   // still never stripped
  });

  it("precedence is table order — off-allowlist beats every rung below it", async () => {
    const { t, sent } = launch({ traceHostAllowlist: ["api.example.com"] });
    await settle();
    await request("https://other.example.com/x", { mode: "no-cors", headers: { traceparent: VALID } });
    await t.flush();
    expect(lastHttp(sent)["traceparent.outcome"]).toBe("skipped_off_allowlist");
  });

  it("an unsampled session injects no header at all — not a flags=00 id", async () => {
    const { t } = launch({ traceHostAllowlist: ["api.example.com"], sessionSampleRate: 0 });
    await settle();
    await request();
    await t.flush();
    expect(lastCall().headers.traceparent).toBeUndefined();
  });

  it("reaches all three injected_* rungs, and never emits injected_unwired", async () => {
    const { t, sent } = launch({ traceHostAllowlist: ["api.example.com"] });
    await settle();

    // A request inside the launch root's window is a child of a live action.
    await request();
    await t.flush();
    expect(lastHttp(sent)["traceparent.outcome"]).toBe("injected_attributed");

    // Past the 2 s idle window the carrier has aged out: the context was lost.
    vi.setSystemTime(Date.now() + 5000);
    await request();
    await t.flush();
    expect(lastHttp(sent)["traceparent.outcome"]).toBe("injected_expired");

    // Backgrounding clears the carrier outright, so the next fetch belongs to no action.
    doc.visibilityState = "hidden";
    for (const fn of doc._listeners.visibilitychange ?? []) fn({});
    await settle();
    await request();
    await t.flush();
    expect(lastHttp(sent)["traceparent.outcome"]).toBe("injected_unattributed");

    const outcomes = sent.map((e) => e.attributes?.["traceparent.outcome"]);
    expect(outcomes).not.toContain("injected_unwired");
  });
});
