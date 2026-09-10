import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { applyBeforeSend } from "./beforeSend";
import type { TelemetryEvent } from "./telemetry";

// The tier table is enforced by re-stamping, never by throwing (§3.6). These cases are
// the two things that can go wrong with that: the re-stamp failing to restore, and a
// broken hook failing open.

beforeEach(() => { vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());

const event = (): TelemetryEvent => ({
    type: "event",
    eventName: "http.request",
    timestamp: "2026-06-14T10:30:00.000Z",
    attributes: {
        "session.id": "session_1_abc",
        "session.start_time": "2026-06-14T10:00:00.000Z",
        "session.sequence": 3,
        "sdk.version": "3.1.0",
        "app.version": "1.2.3",
        "device.platform": "ios",
        "device.id": "device_1_abc_ios",
        "http.url": "https://x/y?token=secret",
        "user.email": "ada@x.io",
    },
});

describe("applyBeforeSend — Tier A is immutable", () => {
    it("re-stamps Tier A keys the hook deleted", () => {
        const out = applyBeforeSend(event(), (e) => {
            for (const k of Object.keys(e.attributes!)) delete e.attributes![k];
            return e;
        });

        expect(out.kind).toBe("kept");
        const a = (out as any).event.attributes;
        expect(a["session.id"]).toBe("session_1_abc");
        expect(a["sdk.version"]).toBe("3.1.0");
        expect(a["app.version"]).toBe("1.2.3");
        expect(a["device.platform"]).toBe("ios");
        // (session.id, session.sequence) is what orders a session's batches (#92)
        expect(a["session.sequence"]).toBe(3);
        // Tier C really was deleted — the hook is not being ignored, only bounded.
        expect(a["http.url"]).toBeUndefined();
        expect(a["user.email"]).toBeUndefined();
    });

    it("re-stamps Tier A keys the hook rewrote or forged", () => {
        const out = applyBeforeSend(event(), (e) => {
            e.attributes!["session.id"] = "forged";
            e.attributes!["sdk.hook_failed"] = 99;   // counters must not be writable
            e.eventName = "app.crash";               // the allowlist bypass §4.7 closes
            e.timestamp = "1999-01-01T00:00:00.000Z";
            e.type = "metric";
            return e;
        });

        const kept = (out as any).event as TelemetryEvent;
        expect(kept.attributes!["session.id"]).toBe("session_1_abc");
        expect(kept.attributes!["sdk.hook_failed"]).toBeUndefined();
        expect(kept.eventName).toBe("http.request");
        expect(kept.metricName).toBeUndefined();
        expect(kept.timestamp).toBe("2026-06-14T10:30:00.000Z");
        expect(kept.type).toBe("event");
    });
});

describe("applyBeforeSend — Tier B and C", () => {
    it("keeps a rewritten device.id but restores a deleted one", () => {
        const hashed = applyBeforeSend(event(), (e) => {
            e.attributes!["device.id"] = "sha256:deadbeef";
            return e;
        });
        expect((hashed as any).event.attributes["device.id"]).toBe("sha256:deadbeef");

        // Deleting it 400s the whole batch at the collector, so it comes back — and so do
        // the two writes that 400 it just as surely as `delete` does.
        for (const wipe of [
            (e: any) => { delete e.attributes["device.id"]; return e; },
            (e: any) => { e.attributes["device.id"] = null; return e; },
            (e: any) => { e.attributes["device.id"] = ""; return e; },
        ]) {
            expect((applyBeforeSend(event(), wipe) as any).event.attributes["device.id"])
                .toBe("device_1_abc_ios");
        }
    });

    it("leaves Tier C alone, including keys the hook added", () => {
        const out = applyBeforeSend(event(), (e) => ({
            ...e,
            attributes: { ...e.attributes, "http.url": "https://x/y", "custom.tag": "redacted" },
        }));
        const a = (out as any).event.attributes;
        expect(a["http.url"]).toBe("https://x/y");
        expect(a["custom.tag"]).toBe("redacted");
        expect(a["user.email"]).toBe("ada@x.io");
    });

    it("restores a metric's deleted value but keeps a rewritten one", () => {
        const metric: TelemetryEvent = {
            type: "metric", metricName: "memory_usage", value: 42,
            timestamp: "2026-06-14T10:30:00.000Z", attributes: { "vital.target": "#pay > input" },
        };
        expect((applyBeforeSend(metric, (e) => { delete e.value; return e; }) as any).event.value).toBe(42);
        expect((applyBeforeSend(metric, (e) => ({ ...e, value: 7 })) as any).event.value).toBe(7);
        // the least-sanitised key on the wire is on a metric, which is why metrics run the hook
        const scrubbed = applyBeforeSend(metric, (e) => {
            delete e.attributes!["vital.target"];
            return e;
        });
        expect((scrubbed as any).event.attributes["vital.target"]).toBeUndefined();
    });
});

describe("applyBeforeSend — drop vs fail", () => {
    it("fails closed when the hook throws", () => {
        expect(applyBeforeSend(event(), () => { throw new Error("boom"); })).toEqual({ kind: "failed" });
    });

    it("drops only on an explicit null", () => {
        expect(applyBeforeSend(event(), () => null)).toEqual({ kind: "dropped" });
    });

    it("counts a hook that returned no event as broken, not as over-broad", () => {
        // A forgotten `return` is a bug, and booking it as `dropped` would inflate the
        // counter that is supposed to mean "my scrubbing rule is too wide".
        expect(applyBeforeSend(event(), (() => undefined) as any)).toEqual({ kind: "failed" });
        expect(applyBeforeSend(event(), (() => "nope") as any)).toEqual({ kind: "failed" });
    });
});
