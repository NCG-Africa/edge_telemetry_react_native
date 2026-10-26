import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TelemetryEvent } from "./core/telemetry";
import { memoryStore } from "./core/memoryStore";

vi.mock("react-native", () => ({
    Platform: { OS: "android" },
    Dimensions: { get: () => ({ width: 390, height: 844 }) },
    PixelRatio: { get: () => 3 },
    AppState: { currentState: "active", addEventListener: () => { } },
}));
vi.mock("react-native-get-random-values", () => ({}));
vi.mock("react-native-device-info", () => ({ default: new Proxy({}, { get: () => async () => "x" }) }));
vi.mock("@react-native-community/netinfo", () => ({
    default: { fetch: async () => ({ type: "wifi", isConnected: true }), addEventListener: () => { } },
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
    default: { getItem: async () => null, setItem: async () => { }, removeItem: async () => { } },
}));

// Native mirror of drain.web.test.ts. #162 — §2.4's draining flush() and §2.5's status table, at the createTelemetry seam: the
// batches that reach the Sender, what it is asked to persist, and the drop counters the next
// row carries.

const PLATFORM = "native";
const create = async (opts: any) => (await import("./createTelemetry.native")).createTelemetry(opts);

/** `fail(n)` is consulted for the nth send *after* launch; the launch's own flush always succeeds. */
function scriptedSender(fail: (call: number) => unknown = () => undefined) {
    const batches: TelemetryEvent[][] = [];
    const persisted: TelemetryEvent[][] = [];
    const at: number[] = [];
    const s = {
        batches, persisted, at, armed: false,
        sender: {
            send: async (e: TelemetryEvent[]) => {
                at.push(Date.now());
                const err = s.armed ? fail(batches.length + 1) : undefined;
                batches.push([...e]);
                if (err) throw err;
            },
            onFailure: async (e: TelemetryEvent[]) => { persisted.push([...e]); },
        },
    };
    return s;
}

async function launch(s: ReturnType<typeof scriptedSender>, batchSize = 10) {
    const t = await create({
        apiKey: "edge_k", endpoint: "https://x/telemetry", sender: s.sender,
        store: memoryStore({ async: true }), batchSize, flushIntervalMs: 0,
    });
    await (t as any).instancePromise;
    await t.flush();               // session.started + app.start out of the way
    s.batches.length = 0; s.at.length = 0; s.armed = true;
    return t;
}

/** Enqueue without tripping the batch-full flush: everything goes through one explicit drain. */
async function enqueue(t: any, n: number) {
    const inst = await t.instancePromise;
    for (let i = 0; i < n; i++) await inst.log("custom_event", { i });
}

/** Run a flush to completion under fake timers, stepping the pacing sleeps. */
async function drain(t: any) {
    let done = false, error: unknown;
    t.flush().then(() => { done = true; }, (e: unknown) => { done = true; error = e; });
    for (let i = 0; i < 200 && !done; i++) await vi.advanceTimersByTimeAsync(100);
    return error;
}

beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => { });
    vi.spyOn(console, "error").mockImplementation(() => { });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-14T10:00:00.000Z"));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe(`#162 draining flush (${PLATFORM})`, () => {
    it("drains the whole backlog sequentially, paced at >= 100 ms per batch", async () => {
        const s = scriptedSender();
        const t = await launch(s, 1000);
        await enqueue(t, 35);
        (await (t as any).instancePromise).batchSize = 10;   // 4 batches from one backlog
        await drain(t);
        expect(s.batches.map(b => b.length)).toEqual([10, 10, 10, 5]);
        for (let i = 1; i < s.at.length; i++) expect(s.at[i] - s.at[i - 1]).toBeGreaterThanOrEqual(100);
    });

    it("stops at the first failure — 5xx persists that batch and sends nothing after it", async () => {
        const s = scriptedSender(n => (n === 2 ? Object.assign(new Error("503"), { status: 503 }) : undefined));
        const t = await launch(s, 1000);
        await enqueue(t, 30);
        (await (t as any).instancePromise).batchSize = 10;
        expect(await drain(t)).toBeTruthy();
        expect(s.batches).toHaveLength(2);
        expect(s.persisted).toHaveLength(1);
        expect((await (t as any).instancePromise).getQueue()).toHaveLength(10);
    });

    it("sends at most 50 batches per call", async () => {
        const s = scriptedSender();
        const t = await launch(s, 1000);
        await enqueue(t, 60);
        (await (t as any).instancePromise).batchSize = 1;
        await drain(t);
        expect(s.batches).toHaveLength(50);
        expect((await (t as any).instancePromise).getQueue()).toHaveLength(10);
    });
});

describe(`#162 §2.5 status handling (${PLATFORM})`, () => {
    it("a 4xx drops the batch — not persisted — books `rejected`, and warns once in dev", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => { });
        const s = scriptedSender(n => (n <= 2 ? { status: 401 } : undefined));
        const t = await launch(s, 1000);
        await enqueue(t, 3);
        await drain(t);
        await enqueue(t, 2);
        await drain(t);
        await t.log("custom_event", { probe: true });
        await drain(t);

        expect(s.persisted).toEqual([]);
        const probe = s.batches.flat().find(e => e.attributes?.probe)!.attributes!;
        expect(probe["sdk.drop_reason"]).toBe("rejected");
        expect(probe["sdk.events_dropped"]).toBe(5);
        expect(warn.mock.calls.filter(c => String(c[0]).includes("rejected a batch")).length).toBe(1);
    });

    it("a 429 requeues, halts the drain, and holds until X-RateLimit-Reset", async () => {
        const resetAt = Date.now() + 5000;
        const s = scriptedSender(n => (n === 1 ? { status: 429, resetAt } : undefined));
        const t = await launch(s, 1000);
        await enqueue(t, 4);
        expect(await drain(t)).toBeTruthy();
        expect(s.persisted).toEqual([]);
        expect((await (t as any).instancePromise).getQueue()).toHaveLength(4);

        await drain(t);                                   // still inside the hold
        expect(s.batches).toHaveLength(1);

        vi.setSystemTime(resetAt + 1);
        await drain(t);
        expect(s.batches).toHaveLength(2);
        expect(s.batches[1]).toHaveLength(4);
    });
});
