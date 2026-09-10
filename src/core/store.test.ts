import { describe, it, expect } from "vitest";
import { memoryStore } from "./memoryStore";
import { unavailableStore, type Store } from "./store";

// The fake is driven in BOTH shapes on purpose: the sync/async asymmetry between the
// web and native builds is load-bearing (#89), so it gets tested deliberately rather
// than flattened by awaiting everything.

describe("memoryStore — sync mode (the web build's shape)", () => {
    it("returns reads without a Promise, so a caller can depend on them being done", () => {
        const store = memoryStore();
        expect(store.sync).toBe(true);

        // No await anywhere in this test: if get() ever started returning a Promise,
        // these assertions fail instead of silently passing on a thenable.
        expect(store.get("device.id")).toEqual({ status: "miss" });
        expect(store.set("device.id", "device_1_abc")).toEqual({ status: "ok" });
        expect(store.get("device.id")).toEqual({ status: "hit", value: "device_1_abc" });
        expect(store.remove("device.id")).toEqual({ status: "ok" });
        expect(store.get("device.id")).toEqual({ status: "miss" });
    });

    it("seeds from opts", () => {
        expect(memoryStore({ seed: { k: "v" } }).get("k")).toEqual({ status: "hit", value: "v" });
    });
});

describe("memoryStore — async mode (the native build's shape)", () => {
    it("returns Promises and round-trips through them", async () => {
        const store = memoryStore({ async: true });
        expect(store.sync).toBe(false);

        const pending = store.get("session.id");
        expect(pending).toBeInstanceOf(Promise);
        expect(await pending).toEqual({ status: "miss" });

        expect(await store.set("session.id", "session_1_abc")).toEqual({ status: "ok" });
        expect(await store.get("session.id")).toEqual({ status: "hit", value: "session_1_abc" });
        expect(await store.remove("session.id")).toEqual({ status: "ok" });
        expect(await store.get("session.id")).toEqual({ status: "miss" });
    });
});

describe("storage-unavailable", () => {
    it("is distinct from a miss, and never throws — sync", () => {
        const down = memoryStore({ unavailable: true, seed: { k: "v" } });

        // Not a miss: the key IS stored. "storage said no" != "storage had nothing".
        expect(down.get("k")).toEqual({ status: "unavailable" });
        expect(memoryStore().get("k")).toEqual({ status: "miss" });

        expect(down.set("k", "v2")).toEqual({ status: "unavailable" });
        expect(down.remove("k")).toEqual({ status: "unavailable" });
    });

    it("is distinct from a miss, and never throws — async", async () => {
        const down = memoryStore({ async: true, unavailable: true, seed: { k: "v" } });
        expect(await down.get("k")).toEqual({ status: "unavailable" });
        expect(await down.set("k", "v2")).toEqual({ status: "unavailable" });
        expect(await down.remove("k")).toEqual({ status: "unavailable" });
    });

    it("is what unavailableStore — shared core's default — reports", () => {
        expect(unavailableStore.get("anything")).toEqual({ status: "unavailable" });
        expect(unavailableStore.set("a", "b")).toEqual({ status: "unavailable" });
        expect(unavailableStore.remove("a")).toEqual({ status: "unavailable" });
    });
});

describe("the Store union", () => {
    it("lets shared core await either build, and narrow when it needs the sync one", async () => {
        for (const store of [memoryStore(), memoryStore({ async: true })] as Store[]) {
            // Shared-core style: await works on both, since awaiting a non-Promise is a no-op.
            await store.set("k", "v");
            expect(await store.get("k")).toEqual({ status: "hit", value: "v" });

            // Caller that needs the guarantee narrows on the discriminant.
            if (store.sync) {
                const read = store.get("k");   // typed StoreRead, not Promise<StoreRead>
                expect(read).toEqual({ status: "hit", value: "v" });
            }
        }
    });
});

describe("shared core stays React-Native-free", () => {
    it("imports nothing platform-specific in the port or the fake", async () => {
        const { readFileSync } = await import("node:fs");
        for (const file of ["src/core/store.ts", "src/core/memoryStore.ts"]) {
            const src = readFileSync(file, "utf8");
            for (const forbidden of ["react-native", "async-storage", "localStorage"]) {
                expect(src, `${file} must not reference ${forbidden}`).not.toContain(forbidden);
            }
        }
    });
});
