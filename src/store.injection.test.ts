import { describe, it, expect, vi, afterEach } from "vitest";
import { Telemetry } from "./core/telemetry";
import { memoryStore } from "./core/memoryStore";

// The injection AC (#89): "The store is injectable and defaults correctly per build."
// Driven through the public factories rather than by reading private manager state —
// `store` is public on Telemetry precisely because it is this seam's observation point.

afterEach(() => vi.restoreAllMocks());

function silenceConsole() {
    vi.spyOn(console, "log").mockImplementation(() => { });
    vi.spyOn(console, "warn").mockImplementation(() => { });
    vi.spyOn(console, "error").mockImplementation(() => { });
}

describe("Store injection — shared core", () => {
    it("takes the injected store verbatim", () => {
        const store = memoryStore();
        expect(new Telemetry({ store }).store).toBe(store);
    });

    it("falls back to an unavailable store when nothing is injected", () => {
        // A direct `new Telemetry()` has no platform storage. It must report the same
        // outcome as incognito, not crash and not pretend a miss.
        const t = new Telemetry();
        expect(t.store.get("device.id")).toEqual({ status: "unavailable" });
    });
});

describe("Store injection — the web build", () => {
    it("defaults to the synchronous localStorage store", async () => {
        silenceConsole();
        const { TelemetryWeb } = await import("./index.web");
        // Subclass access to the protected instance promise — legal, and cheaper than
        // widening the public API just so a test can look.
        class Probe extends TelemetryWeb { core() { return this.instancePromise; } }

        const core = await new Probe({ apiKey: "edge_test", flushIntervalMs: 0 }).core();
        expect(core.store.sync).toBe(true);

        // It is the real localStorage store, not the shared-core fallback: under node
        // there is no localStorage, so it reports unavailable rather than throwing.
        expect(core.store.get("device.id")).toEqual({ status: "unavailable" });
    });

    it("lets a consumer override it through createTelemetry", async () => {
        silenceConsole();
        const { TelemetryWeb } = await import("./index.web");
        class Probe extends TelemetryWeb { core() { return this.instancePromise; } }

        const store = memoryStore({ seed: { "device.id": "device_1_abc" } });
        const core = await new Probe({ apiKey: "edge_test", flushIntervalMs: 0, store }).core();

        expect(core.store).toBe(store);
        expect(core.store.get("device.id")).toEqual({ status: "hit", value: "device_1_abc" });
    });
});
