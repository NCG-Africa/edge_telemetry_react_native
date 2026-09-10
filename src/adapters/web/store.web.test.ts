import { describe, it, expect, afterEach } from "vitest";
import { webStore } from "./store.web";

const g = globalThis as any;

function fakeLocalStorage(over: Partial<Storage> = {}) {
    const map = new Map<string, string>();
    return {
        getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
        setItem: (k: string, v: string) => void map.set(k, v),
        removeItem: (k: string) => void map.delete(k),
        ...over,
    };
}

afterEach(() => { delete g.localStorage; });

describe("webStore", () => {
    it("round-trips synchronously and distinguishes a miss", () => {
        g.localStorage = fakeLocalStorage();
        const store = webStore();

        expect(store.get("device.id")).toEqual({ status: "miss" });
        expect(store.set("device.id", "device_1_abc")).toEqual({ status: "ok" });
        expect(store.get("device.id")).toEqual({ status: "hit", value: "device_1_abc" });
        expect(store.remove("device.id")).toEqual({ status: "ok" });
        expect(store.get("device.id")).toEqual({ status: "miss" });
    });

    it("reports unavailable when localStorage isn't declared at all (non-browser)", () => {
        // No globalThis.localStorage — bare reference throws ReferenceError, not undefined.
        const store = webStore();
        expect(store.get("k")).toEqual({ status: "unavailable" });
        expect(store.set("k", "v")).toEqual({ status: "unavailable" });
        expect(store.remove("k")).toEqual({ status: "unavailable" });
    });

    it("reports unavailable when access throws — incognito, partitioned iframe, quota", () => {
        const boom = () => { throw new DOMException("blocked", "SecurityError"); };
        g.localStorage = fakeLocalStorage({ getItem: boom, setItem: boom, removeItem: boom });
        const store = webStore();

        expect(store.get("k")).toEqual({ status: "unavailable" });
        expect(store.set("k", "v")).toEqual({ status: "unavailable" });
        expect(store.remove("k")).toEqual({ status: "unavailable" });
    });
});
