import { describe, it, expect, vi, beforeEach } from "vitest";

// Native store imports AsyncStorage at module load — stub it so the import resolves under node.
const backing = vi.hoisted(() => ({ map: new Map<string, string>(), fail: false }));
vi.mock("@react-native-async-storage/async-storage", () => ({
    default: {
        getItem: async (k: string) => {
            if (backing.fail) throw new Error("AsyncStorage unavailable");
            return backing.map.has(k) ? backing.map.get(k)! : null;
        },
        setItem: async (k: string, v: string) => {
            if (backing.fail) throw new Error("AsyncStorage unavailable");
            backing.map.set(k, v);
        },
        removeItem: async (k: string) => {
            if (backing.fail) throw new Error("AsyncStorage unavailable");
            backing.map.delete(k);
        },
    },
}));

import { nativeStore } from "./store.native";

beforeEach(() => { backing.map.clear(); backing.fail = false; });

describe("nativeStore", () => {
    it("is async — reads settle later, which is why the crash window only narrows here", async () => {
        const store = nativeStore();
        expect(store.sync).toBe(false);
        expect(store.get("device.id")).toBeInstanceOf(Promise);
    });

    it("round-trips and distinguishes a miss", async () => {
        const store = nativeStore();

        expect(await store.get("device.id")).toEqual({ status: "miss" });
        expect(await store.set("device.id", "device_1_abc")).toEqual({ status: "ok" });
        expect(await store.get("device.id")).toEqual({ status: "hit", value: "device_1_abc" });
        expect(await store.remove("device.id")).toEqual({ status: "ok" });
        expect(await store.get("device.id")).toEqual({ status: "miss" });
    });

    it("reports unavailable — not a throw, not a miss — when AsyncStorage rejects", async () => {
        backing.map.set("k", "v");
        backing.fail = true;
        const store = nativeStore();

        expect(await store.get("k")).toEqual({ status: "unavailable" });
        expect(await store.set("k", "v2")).toEqual({ status: "unavailable" });
        expect(await store.remove("k")).toEqual({ status: "unavailable" });
    });
});
