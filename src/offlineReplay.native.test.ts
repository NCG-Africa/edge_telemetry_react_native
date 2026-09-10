import { describe, it, expect, vi, afterEach } from "vitest";
import { memoryStore } from "./core/memoryStore";
import { nativeSender } from "./adapters/nativeSender";
import { decodeFailed, FAILED_EVENTS_KEY } from "./adapters/failedEvents";
import type { TelemetryEvent } from "./core/telemetry";

// #113: the offline queue had two replay paths on native — core's `sender.replayFailed()`
// hook and a standalone `replayFailedNative` the entry also called — so every recovered
// batch went out twice. Counted on the wire, which is where the duplicate showed up.

vi.mock("react-native", () => ({
    Platform: { OS: "android" },
    Dimensions: { get: () => ({ width: 390, height: 844 }) },
    PixelRatio: { get: () => 3 },
    AppState: { currentState: "active", addEventListener: () => { } },
}));
vi.mock("react-native-device-info", () => ({
    default: new Proxy({}, { get: () => async () => "stub" }),
}));
vi.mock("@react-native-community/netinfo", () => ({
    default: { fetch: async () => ({ type: "wifi", isConnected: true }), addEventListener: () => { } },
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
    default: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined },
}));

afterEach(() => vi.restoreAllMocks());

const persisted: TelemetryEvent = {
    type: "event",
    eventName: "app.crash",
    timestamp: "2026-01-01T00:00:00.000Z",
    attributes: { "error.type": "TypeError" },
};

const seeded = () =>
    memoryStore({ async: true, seed: { [FAILED_EVENTS_KEY]: JSON.stringify([persisted]) } });

/** How many POSTed batches carried the recovered crash. */
const recoveredBatches = (fetchMock: any) =>
    fetchMock.mock.calls.filter(([, init]: any) =>
        JSON.parse(init.body).events.some((e: TelemetryEvent) => e.attributes?.["error.type"] === "TypeError"),
    ).length;

describe("offline replay — native (#113)", () => {
    it("sends a recovered batch exactly once through a full init", async () => {
        vi.spyOn(console, "log").mockImplementation(() => { });
        vi.spyOn(console, "warn").mockImplementation(() => { });
        const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as any);
        vi.stubGlobal("fetch", fetchMock);
        const store = seeded();

        const { TelemetryNative } = await import("./index.native");
        class Probe extends TelemetryNative { core() { return this.instancePromise; } }
        await new Probe({ apiKey: "edge_test", flushIntervalMs: 0, store }).core();
        await vi.waitFor(() => expect(recoveredBatches(fetchMock)).toBeGreaterThan(0));

        expect(recoveredBatches(fetchMock)).toBe(1);
        expect(await store.get(FAILED_EVENTS_KEY)).toEqual({ status: "miss" });
    });

    it("cannot send the same batch twice when two drains race", async () => {
        const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as any);
        vi.stubGlobal("fetch", fetchMock);
        const sender = nativeSender("https://x/collect", "edge_k", seeded());

        // takeFailed() clears before it sends, but two concurrent drains both read the
        // payload before either removes it — the guard is what closes that.
        await Promise.all([sender.replayFailed!(), sender.replayFailed!()]);

        expect(recoveredBatches(fetchMock)).toBe(1);
    });

    it("re-persists exactly one copy when the replay fails again", async () => {
        vi.useFakeTimers();
        try {
            vi.spyOn(console, "warn").mockImplementation(() => { });
            vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("still down"); }));
            const store = seeded();
            const sender = nativeSender("https://x/collect", "edge_k", store);

            const settled = expect(sender.replayFailed!()).rejects.toThrow();
            await vi.runAllTimersAsync();
            await settled;

            expect(decodeFailed(await store.get(FAILED_EVENTS_KEY))).toHaveLength(1);
        } finally {
            vi.useRealTimers();
        }
    });
});
