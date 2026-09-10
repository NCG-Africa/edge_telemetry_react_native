import { describe, it, expect } from "vitest";
import { decodeFailed, encodeFailed, FAILED_EVENTS_KEY, STORE_MAX_BYTES, STORE_MAX_EVENTS } from "./failedEvents";
import type { TelemetryEvent } from "../core/telemetry";

const event = (eventName: string): TelemetryEvent => ({
    type: "event",
    eventName,
    timestamp: "2026-01-01T00:00:00.000Z",
});

describe("decodeFailed", () => {
    it("decodes a stored batch", () => {
        const events = [event("navigation")];
        expect(decodeFailed({ status: "hit", value: JSON.stringify(events) })).toEqual(events);
    });

    it("treats a miss as nothing to replay", () => {
        expect(decodeFailed({ status: "miss" })).toEqual([]);
    });

    it("treats an unavailable store as nothing to replay — not an error", () => {
        expect(decodeFailed({ status: "unavailable" })).toEqual([]);
    });

    it("drops a half-written payload instead of throwing", () => {
        // A process killed mid-write leaves truncated JSON. Startup must survive it.
        expect(() => decodeFailed({ status: "hit", value: '[{"type":"eve' })).not.toThrow();
        expect(decodeFailed({ status: "hit", value: '[{"type":"eve' })).toEqual([]);
    });

    it("drops valid JSON that isn't an array", () => {
        expect(decodeFailed({ status: "hit", value: '{"not":"an array"}' })).toEqual([]);
        expect(decodeFailed({ status: "hit", value: "null" })).toEqual([]);
    });
});

describe("encodeFailed", () => {
    it("appends oldest-first and round-trips through decodeFailed", () => {
        const older = [event("session.started")];
        const newer = [event("app.crash")];
        const { json, dropped } = encodeFailed(older, newer);

        expect(decodeFailed({ status: "hit", value: json }).map(e => e.eventName))
            .toEqual(["session.started", "app.crash"]);
        expect(dropped).toBe(0);
    });

    it("starts a queue from empty", () => {
        expect(decodeFailed({ status: "hit", value: encodeFailed([], [event("x")]).json })).toHaveLength(1);
    });
});

// #94 §9.4 — the store is capped so a long offline period cannot eat the host app's
// storage budget (Android caps AsyncStorage at 6 MB app-wide; web localStorage is ~5 MB).
describe("encodeFailed — the §9.4 cap", () => {
    it("caps at 500 events, dropping oldest, and reports the count", () => {
        const existing = Array.from({ length: 600 }, (_, i) => event(`e${i}`));
        const { json, dropped } = encodeFailed(existing, [event("newest")]);

        const kept = decodeFailed({ status: "hit", value: json });
        expect(kept).toHaveLength(STORE_MAX_EVENTS);
        expect(dropped).toBe(101);
        expect(kept[kept.length - 1].eventName).toBe("newest");
        expect(kept[0].eventName).toBe("e101");   // the oldest 101 went, not a middle slice
    });

    it("caps at 1 MB, and measures the encoded payload rather than the event count", () => {
        // 20 x ~100 KB clears the 500-event cap and blows the byte cap on its own.
        const fat = Array.from({ length: 20 }, (_, i) =>
            ({ ...event(`fat${i}`), attributes: { blob: "x".repeat(100_000) } }));
        const { json, dropped } = encodeFailed(fat, []);

        expect(json.length).toBeLessThanOrEqual(STORE_MAX_BYTES);
        expect(dropped).toBeGreaterThan(0);
        // Newest survive: the tail is what a replay most wants.
        const kept = decodeFailed({ status: "hit", value: json });
        expect(kept[kept.length - 1].eventName).toBe("fat19");
    });

    it("evicts app.crash last, so a bad network cannot flatter the crash-free rate", () => {
        const existing = [
            event("app.crash"),
            ...Array.from({ length: 600 }, (_, i) => event(`e${i}`)),
        ];
        const kept = decodeFailed({ status: "hit", value: encodeFailed(existing, []).json });

        expect(kept[0].eventName).toBe("app.crash");
        expect(kept.filter(e => e.eventName === "app.crash")).toHaveLength(1);
    });

    it("still gets under the cap when every row is a crash", () => {
        const crashes = Array.from({ length: 600 }, () => event("app.crash"));
        const { json, dropped } = encodeFailed(crashes, []);

        expect(decodeFailed({ status: "hit", value: json })).toHaveLength(STORE_MAX_EVENTS);
        expect(dropped).toBe(100);
    });
});

describe("the key", () => {
    it("is unchanged, so queues written by earlier versions still replay", () => {
        expect(FAILED_EVENTS_KEY).toBe("telemetry_failed_events");
    });
});
