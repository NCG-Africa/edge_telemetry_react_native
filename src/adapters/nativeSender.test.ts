import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TelemetryEvent } from "../core/telemetry";

// Native sender imports AsyncStorage at module load — stub it so the import resolves under node.
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

import { nativeSender } from "./nativeSender";
import { memoryStore } from "../core/memoryStore";
import { decodeFailed, FAILED_EVENTS_KEY } from "./failedEvents";

const event = (eventName: string): TelemetryEvent => ({
  type: "event",
  eventName,
  timestamp: "2026-01-01T00:00:00.000Z",
  attributes: { "user.id": "user_1_0000000000000000" },
});

describe("nativeSender — v3 transport envelope (Seam 2)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("POSTs a telemetry_batch envelope with both credential headers, no tenant_id", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as any);
    vi.stubGlobal("fetch", fetchMock);

    const endpoint = "https://collector.example.com/telemetry";
    const sender = nativeSender(endpoint, "edge_test_key");

    await sender.send([event("navigation"), event("http.request")]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(endpoint);
    expect(init.method).toBe("POST");

    const headers = init.headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBe("edge_test_key");
    // Both headers, always, same value: the collector reads one or the other by AUTH_MODE (#90).
    expect(headers["Authorization"]).toBe("Bearer edge_test_key");
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init.body as string);
    expect(body.type).toBe("telemetry_batch");
    expect(typeof body.timestamp).toBe("string");
    expect(body.batch_size).toBe(2);
    expect(body.events).toHaveLength(2);
    expect(body.tenant_id).toBeUndefined();
  });
});

describe("nativeSender — the offline queue through the Store port (#89)", () => {
  beforeEach(() => vi.restoreAllMocks());

  const failing = () => vi.fn(async () => { throw new Error("network down"); });
  const seeded = (events: TelemetryEvent[]) =>
    memoryStore({ async: true, seed: { [FAILED_EVENTS_KEY]: JSON.stringify(events) } });

  it("persists a failed batch into the INJECTED store, not its own", async () => {
    const store = memoryStore({ async: true });
    const sender = nativeSender("https://x/collect", "edge_k", store);

    await sender.onFailure!([event("app.crash")]);

    expect(decodeFailed(await store.get(FAILED_EVENTS_KEY)).map(e => e.eventName))
      .toEqual(["app.crash"]);
  });

  it("appends to an existing queue rather than clobbering it", async () => {
    const store = memoryStore({ async: true });
    const sender = nativeSender("https://x/collect", "edge_k", store);

    await sender.onFailure!([event("session.started")]);
    await sender.onFailure!([event("app.crash")]);

    expect(decodeFailed(await store.get(FAILED_EVENTS_KEY)).map(e => e.eventName))
      .toEqual(["session.started", "app.crash"]);
  });

  it("does not throw when storage is unavailable — the batch is already lost", async () => {
    const store = memoryStore({ async: true, unavailable: true });
    const sender = nativeSender("https://x/collect", "edge_k", store);

    // Resolves to the §9.4 drop count, and nothing the *cap* dropped: the store refused
    // the whole write, which is not the same thing as evicting to fit.
    await expect(sender.onFailure!([event("app.crash")])).resolves.toBe(0);
  });

  it("replayFailed() drains the queue and clears it on success", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as any);
    vi.stubGlobal("fetch", fetchMock);
    const store = seeded([event("app.crash")]);

    await nativeSender("https://x/collect", "edge_k", store).replayFailed!();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await store.get(FAILED_EVENTS_KEY)).toEqual({ status: "miss" });
  });

  it("re-persists when the replay fails again, so nothing is dropped", async () => {
    // Fake timers: the native backoff is exponential (500·2^n + jitter), so real time
    // here costs ~3s for one assertion.
    vi.useFakeTimers();
    try {
      vi.stubGlobal("fetch", failing());
      const store = seeded([event("app.crash")]);

      const replay = nativeSender("https://x/collect", "edge_k", store).replayFailed!();
      const settled = expect(replay).rejects.toThrow();
      await vi.runAllTimersAsync();
      await settled;

      expect(decodeFailed(await store.get(FAILED_EVENTS_KEY)).map(e => e.eventName))
        .toEqual(["app.crash"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("survives a half-written queue, and clears it so it can't stick forever", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as any);
    vi.stubGlobal("fetch", fetchMock);
    const store = memoryStore({ async: true, seed: { [FAILED_EVENTS_KEY]: '[{"type":"eve' } });

    await expect(nativeSender("https://x/collect", "edge_k", store).replayFailed!()).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await store.get(FAILED_EVENTS_KEY)).toEqual({ status: "miss" });
  });

  it("accepts a synchronous store too — the native path only ever awaits", async () => {
    // The union is deliberate here: awaiting a sync store is a no-op. The reverse —
    // a sync store on the web build — is what the types forbid.
    const store = memoryStore();
    const sender = nativeSender("https://x/collect", "edge_k", store);

    await sender.onFailure!([event("app.crash")]);

    expect(decodeFailed(store.get(FAILED_EVENTS_KEY))).toHaveLength(1);
  });
});
