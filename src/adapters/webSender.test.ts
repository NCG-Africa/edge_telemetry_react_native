import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TelemetryEvent } from "../core/telemetry";
import { webSender } from "./webSender";

const event = (eventName: string): TelemetryEvent => ({
  type: "event",
  eventName,
  timestamp: "2026-01-01T00:00:00.000Z",
  attributes: { "user.id": "user_1_0000000000000000" },
});

describe("webSender — v3 transport envelope (Seam 2)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("POSTs a telemetry_batch envelope with X-API-Key when sendBeacon is unavailable", async () => {
    // no navigator.sendBeacon in node → falls back to fetch
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as any);
    vi.stubGlobal("fetch", fetchMock);

    const endpoint = "https://collector.example.com/collector/telemetry";
    const sender = webSender(endpoint, "edge_web_key");

    await sender.send([event("navigation"), event("http.request")]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(endpoint);

    const headers = init.headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBe("edge_web_key");

    const body = JSON.parse(init.body as string);
    expect(body.type).toBe("telemetry_batch");
    expect(body.batch_size).toBe(2);
    expect(body.events).toHaveLength(2);
    expect(body.tenant_id).toBeUndefined();
  });
});
