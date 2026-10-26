import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTelemetry } from "./createTelemetry.web";
import type { TelemetryEvent } from "./core/telemetry";
import { SESSION_KEY } from "./core/telemetry";
import { memoryStore } from "./core/memoryStore";
import type { SyncStore } from "./core/store";

// #161 — two tabs over one localStorage record. A real browser fires `storage` in every tab
// *except* the writer, so the simulation wraps the shared store: each tab's write is delivered
// to the other tab's listener only.

const MIN = 60 * 1000;

type Tab = { t: ReturnType<typeof createTelemetry>; sent: TelemetryEvent[]; fire: (raw: string) => Promise<void> };

/** A browser window per tab, so each tab's `storage` listener is addressable on its own. */
function openTab(store: SyncStore): Tab {
    const listeners: Record<string, ((e: any) => void)[]> = {};
    vi.stubGlobal("window", { addEventListener: (type: string, fn: any) => { (listeners[type] ??= []).push(fn); } });
    const sent: TelemetryEvent[] = [];
    const t = createTelemetry({
        apiKey: "edge_k", endpoint: "https://x/telemetry",
        sender: { send: async (e: TelemetryEvent[]) => { sent.push(...e); } },
        store, batchSize: 500, flushIntervalMs: 0,
    });
    return {
        t, sent,
        fire: async (raw: string) => {
            for (const fn of listeners.storage ?? []) fn({ key: SESSION_KEY, newValue: raw });
            for (let i = 0; i < 200; i++) await Promise.resolve();
        },
    };
}

async function ready(tab: Tab) {
    await (tab.t as any).instancePromise;
    for (let i = 0; i < 200; i++) await Promise.resolve();
}

/** The shared record, as the sibling tab would see it in its `storage` event. */
const record = (store: SyncStore) => {
    const r = store.get(SESSION_KEY);
    return r.status === "hit" ? r.value : "";
};

const names = (sent: TelemetryEvent[], n: string) => sent.filter(e => e.eventName === n);

beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => { });
    vi.spyOn(console, "warn").mockImplementation(() => { });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-14T10:00:00.000Z"));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("#161 cross-tab session sync", () => {
    it("a sibling's activity keeps this tab's session alive — no idle finalize of a session in use", async () => {
        const store = memoryStore();
        const a = openTab(store); await ready(a);
        const b = openTab(store); await ready(b);

        // B is busy for 40 minutes while A sits idle; every B write reaches A.
        for (let i = 0; i < 4; i++) {
            vi.setSystemTime(Date.now() + 10 * MIN);
            await b.t.log("custom_event");
            await a.fire(record(store));
        }
        await a.t.log("custom_event");
        await a.t.flush(); await b.t.flush();

        expect(names(a.sent, "session.finalized")).toHaveLength(0);
        const ids = new Set([...a.sent, ...b.sent].filter(e => e.eventName === "custom_event").map(e => e.attributes!["session.id"]));
        expect(ids.size).toBe(1);
    });

    it("a rotation in tab A is adopted by tab B; the session.id is finalized exactly once", async () => {
        const store = memoryStore();
        const a = openTab(store); await ready(a);
        const b = openTab(store); await ready(b);
        await a.t.flush();
        const s1 = names(a.sent, "session.started")[0].attributes!["session.id"];

        vi.setSystemTime(Date.now() + 31 * MIN);
        await a.t.log("custom_event");            // A idle-rotates S1 → S2
        await b.fire(record(store));              // …and B hears about it
        await b.t.log("custom_event");
        await a.t.flush(); await b.t.flush();

        const all = [...a.sent, ...b.sent];
        const finalized = names(all, "session.finalized").map(e => e.attributes!["session.id"]);
        expect(finalized).toEqual([s1]);
        const s2 = names(a.sent, "custom_event")[0].attributes!["session.id"];
        expect(s2).not.toBe(s1);
        expect(names(b.sent, "custom_event")[0].attributes!["session.id"]).toBe(s2);
        // B announced nothing of its own: S2's session.started shipped from A.
        expect(names(b.sent, "session.started").filter(e => e.attributes!["session.id"] === s2)).toEqual([]);

        // B's view never spans the two sessions: the row it emitted for S1 is under S1, and
        // its live view under S2 is a fresh one.
        const bViews = names(b.sent, "view");
        expect(bViews.every(v => v.attributes!["session.id"] === s1)).toBe(true);
        const bView2 = names(b.sent, "custom_event")[0].attributes!["view.id"];
        expect(bViews.map(v => v.attributes!["view.id"])).not.toContain(bView2);
    });

    it("ignores a stale record from before this tab's session, and garbage", async () => {
        const store = memoryStore();
        const b = openTab(store); await ready(b);
        await b.fire(JSON.stringify({ id: "session_old", start: 1, lastActivity: 1 }));
        await b.fire("{not json");
        await b.t.log("custom_event");
        await b.t.flush();
        expect(names(b.sent, "custom_event")[0].attributes!["session.id"]).not.toBe("session_old");
    });
});
