// The Store port (#89).
//
// v4 puts persisted state — device.id, session resume, the sticky sample rate, the
// capped offline store — in shared core, and shared core may not import React Native.
// That is what forces this seam.
//
// Web is synchronous and native is asynchronous, and the difference is load-bearing:
// it is exactly why the crash-loss window *closes* on web and only *narrows* on
// native. The port keeps that asymmetry in the types rather than hiding it behind a
// uniform Promise, so a caller holding a SyncStore can depend on the read being done
// by the time the next line runs.
//
// Shared code that doesn't care can `await` either side — awaiting a non-Promise is a
// no-op — and narrow on the `sync` discriminant when it does.

/**
 * Reading storage has three outcomes, not two.
 *
 * `unavailable` is a first-class path, not an error: incognito, partitioned iframes,
 * Safari ITP eviction and full disks all land here, and they are the population
 * `device.id_ephemeral` reports (wire contract §3.2). It is deliberately distinct
 * from `miss` — "storage said no" is not "storage had nothing stored".
 */
export type StoreRead =
    | { status: "hit"; value: string }
    | { status: "miss" }
    | { status: "unavailable" };

/** Writes and removes carry the same unavailable path — quota exceeded, disk full. */
export type StoreWrite =
    | { status: "ok" }
    | { status: "unavailable" };

/** Storage whose reads have completed by the time they return. The web build. */
export interface SyncStore {
    readonly sync: true;
    get(key: string): StoreRead;
    set(key: string, value: string): StoreWrite;
    remove(key: string): StoreWrite;
}

/** Storage whose reads settle later. The native build. */
export interface AsyncStore {
    readonly sync: false;
    get(key: string): Promise<StoreRead>;
    set(key: string, value: string): Promise<StoreWrite>;
    remove(key: string): Promise<StoreWrite>;
}

/**
 * Either build. Shared core takes this; a caller that needs the synchronous
 * guarantee narrows with `if (store.sync)` or takes `SyncStore` outright.
 */
export type Store = SyncStore | AsyncStore;

/** No storage at all. The default in shared core until a build injects a real one. */
export const unavailableStore: SyncStore = {
    sync: true,
    get: () => ({ status: "unavailable" }),
    set: () => ({ status: "unavailable" }),
    remove: () => ({ status: "unavailable" }),
};
