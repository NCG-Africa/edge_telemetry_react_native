import { describe, it, expect } from "vitest";
import { decodeFailed, encodeFailed, FAILED_EVENTS_KEY } from "./failedEvents";
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
        const encoded = encodeFailed(older, newer);

        expect(decodeFailed({ status: "hit", value: encoded }).map(e => e.eventName))
            .toEqual(["session.started", "app.crash"]);
    });

    it("starts a queue from empty", () => {
        expect(decodeFailed({ status: "hit", value: encodeFailed([], [event("x")]) })).toHaveLength(1);
    });
});

describe("the key", () => {
    it("is unchanged, so queues written by earlier versions still replay", () => {
        expect(FAILED_EVENTS_KEY).toBe("telemetry_failed_events");
    });
});
