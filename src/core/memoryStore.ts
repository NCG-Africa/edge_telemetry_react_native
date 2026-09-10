import type { AsyncStore, Store, StoreRead, StoreWrite, SyncStore } from "./store";

export type MemoryStoreOpts = {
    /** Mirror the native build's Promise-returning shape instead of the web build's. */
    async?: boolean;
    /** Behave like incognito / a full disk: every call reports `unavailable`. */
    unavailable?: boolean;
    /** Pre-seeded contents. */
    seed?: Record<string, string>;
};

/**
 * In-memory Store (#89). A production-shaped seam that tests get to use, not a
 * test-only affordance — it ships, and it is the right injection for a consumer
 * that wants telemetry state to die with the process.
 *
 * Configurable to either build's shape so the sync/async asymmetry can be tested
 * deliberately rather than assumed away.
 */
export function memoryStore(opts: MemoryStoreOpts & { async: true }): AsyncStore;
export function memoryStore(opts?: MemoryStoreOpts & { async?: false }): SyncStore;
export function memoryStore(opts: MemoryStoreOpts = {}): Store {
    const map = new Map<string, string>(Object.entries(opts.seed ?? {}));
    const unavailable = opts.unavailable === true;

    const get = (key: string): StoreRead => {
        if (unavailable) return { status: "unavailable" };
        const value = map.get(key);
        return value === undefined ? { status: "miss" } : { status: "hit", value };
    };
    const set = (key: string, value: string): StoreWrite => {
        if (unavailable) return { status: "unavailable" };
        map.set(key, value);
        return { status: "ok" };
    };
    const remove = (key: string): StoreWrite => {
        if (unavailable) return { status: "unavailable" };
        map.delete(key);
        return { status: "ok" };
    };

    return opts.async
        ? {
            sync: false,
            get: async k => get(k),
            set: async (k, v) => set(k, v),
            remove: async k => remove(k),
        }
        : { sync: true, get, set, remove };
}
