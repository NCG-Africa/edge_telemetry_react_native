import { describe, it, expect, vi, afterEach } from "vitest";
import { memoryStore } from "./core/memoryStore";

// Native mirror of store.injection.test.ts. Platform APIs are module-stubbed, matching
// integration.native.test.ts; the native default must be the ASYNC store, and that
// asymmetry against the web build is the point of the port (#89).
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

const backing = vi.hoisted(() => ({ map: new Map<string, string>() }));
vi.mock("@react-native-async-storage/async-storage", () => ({
    default: {
        getItem: async (k: string) => (backing.map.has(k) ? backing.map.get(k)! : null),
        setItem: async (k: string, v: string) => void backing.map.set(k, v),
        removeItem: async (k: string) => void backing.map.delete(k),
    },
}));

afterEach(() => vi.restoreAllMocks());

function silenceConsole() {
    vi.spyOn(console, "log").mockImplementation(() => { });
    vi.spyOn(console, "warn").mockImplementation(() => { });
    vi.spyOn(console, "error").mockImplementation(() => { });
}

describe("Store injection — the native build", () => {
    it("defaults to the asynchronous AsyncStorage store", async () => {
        silenceConsole();
        const { TelemetryNative } = await import("./index.native");
        class Probe extends TelemetryNative { core() { return this.instancePromise; } }

        const core = await new Probe({ apiKey: "edge_test", flushIntervalMs: 0 }).core();

        // Not sync: this build cannot promise a write has landed before the process dies.
        expect(core.store.sync).toBe(false);

        backing.map.set("device.id", "device_1_abc");
        expect(await core.store.get("device.id")).toEqual({ status: "hit", value: "device_1_abc" });
    });

    it("lets a consumer override it through the constructor", async () => {
        silenceConsole();
        const { TelemetryNative } = await import("./index.native");
        class Probe extends TelemetryNative { core() { return this.instancePromise; } }

        const store = memoryStore({ async: true });
        const core = await new Probe({ apiKey: "edge_test", flushIntervalMs: 0, store }).core();

        expect(core.store).toBe(store);
        expect(core.store.sync).toBe(false);
    });
});
