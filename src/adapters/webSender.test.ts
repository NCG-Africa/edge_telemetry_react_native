import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TelemetryEvent } from "../core/telemetry";
import { webSender, replayFailedWeb } from "./webSender";
import { memoryStore } from "../core/memoryStore";
import { decodeFailed, FAILED_EVENTS_KEY } from "./failedEvents";

const event = (eventName: string): TelemetryEvent => ({
  type: "event",
  eventName,
  timestamp: "2026-01-01T00:00:00.000Z",
  attributes: { "user.id": "user_1_0000000000000000" },
});

describe("webSender — v3 transport envelope (Seam 2)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("POSTs a telemetry_batch envelope with both credential headers when sendBeacon is unavailable", async () => {
    // no navigator.sendBeacon in node → falls back to fetch
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as any);
    vi.stubGlobal("fetch", fetchMock);

    const endpoint = "https://collector.example.com/telemetry";
    const sender = webSender(endpoint, "edge_web_key");

    await sender.send([event("navigation"), event("http.request")]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(endpoint);

    const headers = init.headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBe("edge_web_key");
    // Both headers, always, same value: the collector reads one or the other by AUTH_MODE (#90).
    expect(headers["Authorization"]).toBe("Bearer edge_web_key");

    const body = JSON.parse(init.body as string);
    expect(body.type).toBe("telemetry_batch");
    expect(body.batch_size).toBe(2);
    expect(body.events).toHaveLength(2);
    expect(body.tenant_id).toBeUndefined();
  });
});

describe("webSender — the offline queue through the Store port (#89)", () => {
  beforeEach(() => vi.restoreAllMocks());

  const failing = () => vi.fn(async () => { throw new Error("network down"); });

  it("persists a failed batch into the INJECTED store, not its own", async () => {
    const store = memoryStore();
    const sender = webSender("https://x/collect", "edge_k", store);

    await sender.onFailure!([event("app.crash")]);

    const read = store.get(FAILED_EVENTS_KEY);
    expect(decodeFailed(read).map(e => e.eventName)).toEqual(["app.crash"]);
  });

  it("persists SYNCHRONOUSLY — the write has landed before onFailure's promise settles", () => {
    // This is the web build's whole guarantee: onFailure runs on the unload path, and a
    // synchronous set() closes the crash-loss window instead of merely narrowing it.
    // Deliberately not awaited — if persistence ever moves behind an await, this fails.
    const store = memoryStore();
    const sender = webSender("https://x/collect", "edge_k", store);

    void sender.onFailure!([event("app.crash")]);

    expect(decodeFailed(store.get(FAILED_EVENTS_KEY))).toHaveLength(1);
  });

  it("appends to an existing queue rather than clobbering it", async () => {
    const store = memoryStore();
    const sender = webSender("https://x/collect", "edge_k", store);

    await sender.onFailure!([event("session.started")]);
    await sender.onFailure!([event("app.crash")]);

    expect(decodeFailed(store.get(FAILED_EVENTS_KEY)).map(e => e.eventName))
      .toEqual(["session.started", "app.crash"]);
  });

  it("does not throw when storage is unavailable — the batch is already lost", async () => {
    const store = memoryStore({ unavailable: true });
    const sender = webSender("https://x/collect", "edge_k", store);

    // Resolves to the §9.4 drop count, and nothing the *cap* dropped: the store refused
    // the whole write, which is not the same thing as evicting to fit.
    await expect(sender.onFailure!([event("app.crash")])).resolves.toBe(0);
  });

  it("replays the queue and clears it on success", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as any);
    vi.stubGlobal("fetch", fetchMock);
    const store = memoryStore({ seed: { [FAILED_EVENTS_KEY]: JSON.stringify([event("app.crash")]) } });

    await replayFailedWeb("https://x/collect", "edge_k", store);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.get(FAILED_EVENTS_KEY)).toEqual({ status: "miss" });
  });

  it("re-persists when the replay fails again, so nothing is dropped", async () => {
    vi.stubGlobal("fetch", failing());
    const store = memoryStore({ seed: { [FAILED_EVENTS_KEY]: JSON.stringify([event("app.crash")]) } });

    await replayFailedWeb("https://x/collect", "edge_k", store, 1);

    expect(decodeFailed(store.get(FAILED_EVENTS_KEY)).map(e => e.eventName)).toEqual(["app.crash"]);
  });

  it("survives a half-written queue, and clears it so it can't stick forever", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as any);
    vi.stubGlobal("fetch", fetchMock);
    const store = memoryStore({ seed: { [FAILED_EVENTS_KEY]: '[{"type":"eve' } });

    // Nothing to replay, so no promise is returned and nothing is sent — and crucially
    // the junk is gone, rather than being re-read and re-dropped on every launch.
    expect(() => replayFailedWeb("https://x/collect", "edge_k", store)).not.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.get(FAILED_EVENTS_KEY)).toEqual({ status: "miss" });
  });

  it("does nothing when there is no queue", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as any);
    vi.stubGlobal("fetch", fetchMock);

    await replayFailedWeb("https://x/collect", "edge_k", memoryStore());

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
