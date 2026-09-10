import { describe, it, expect, vi, afterEach } from "vitest";
import { memoryStore } from "./core/memoryStore";
import { webSender } from "./adapters/webSender";
import { decodeFailed, FAILED_EVENTS_KEY } from "./adapters/failedEvents";
import type { TelemetryEvent } from "./core/telemetry";

// #113: web had no `replayFailed()` on its sender and no caller for the standalone twin,
// so `onFailure()` faithfully persisted every failed batch and nothing ever sent it. The
// queue only grew. Native's mirror is offlineReplay.native.test.ts.

afterEach(() => vi.restoreAllMocks());

const persisted: TelemetryEvent = {
    type: "event",
    eventName: "app.crash",
    timestamp: "2026-01-01T00:00:00.000Z",
    attributes: { "error.type": "TypeError" },
};

const seeded = () => memoryStore({ seed: { [FAILED_EVENTS_KEY]: JSON.stringify([persisted]) } });

/** How many POSTed batches carried the recovered crash. */
const recoveredBatches = (fetchMock: any) =>
    fetchMock.mock.calls.filter(([, init]: any) =>
        JSON.parse(init.body).events.some((e: TelemetryEvent) => e.attributes?.["error.type"] === "TypeError"),
    ).length;

describe("offline replay — web (#113)", () => {
    it("replays the persisted queue through a full init and clears the key", async () => {
        vi.spyOn(console, "log").mockImplementation(() => { });
        vi.spyOn(console, "warn").mockImplementation(() => { });
        const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as any);
        vi.stubGlobal("fetch", fetchMock);
        const store = seeded();

        const { TelemetryWeb } = await import("./index.web");
        class Probe extends TelemetryWeb { core() { return this.instancePromise; } }
        await new Probe({ apiKey: "edge_test", flushIntervalMs: 0, store }).core();
        await vi.waitFor(() => expect(recoveredBatches(fetchMock)).toBeGreaterThan(0));

        expect(recoveredBatches(fetchMock)).toBe(1);
        expect(store.get(FAILED_EVENTS_KEY)).toEqual({ status: "miss" });
    });

    it("cannot send the same batch twice when two drains race", async () => {
        const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as any);
        vi.stubGlobal("fetch", fetchMock);
        const sender = webSender("https://x/collect", "edge_k", seeded());

        await Promise.all([sender.replayFailed!(), sender.replayFailed!()]);

        // Holds by construction on this build, not by a guard: the store is synchronous,
        // so `takeFailed()` has cleared the key before the first drain yields and the
        // second reads a miss. Native needs `guardedDrain()` for the same property and
        // its mirror test fails without it — this one asserts the outcome either way.
        expect(recoveredBatches(fetchMock)).toBe(1);
    });

    it("exposes exactly one replay path — no standalone twin left to double-call", async () => {
        // The dead `replayFailedWeb` export is what the entry never called; the fix is
        // only "one path per build" if nothing can reach a second one (#113).
        const mod = await import("./adapters/webSender");
        expect(Object.keys(mod).filter(k => k.startsWith("replayFailed"))).toEqual([]);
    });

    it("re-persists exactly one copy when the replay fails again", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => { });
        vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("still down"); }));
        const store = seeded();

        await expect(webSender("https://x/collect", "edge_k", store, 1).replayFailed!())
            .rejects.toThrow();

        expect(decodeFailed(store.get(FAILED_EVENTS_KEY))).toHaveLength(1);
    });
});
