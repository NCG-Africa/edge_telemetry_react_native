import type { StoreRead, StoreWrite, SyncStore } from "../../core/store";

/**
 * localStorage-backed Store for the web build (#89). Reads are synchronous, and
 * that is the point: state written here is durable before the next line runs, so
 * the crash-loss window closes rather than narrows.
 *
 * Every access is guarded. Touching `localStorage` throws — not returns null — in
 * incognito with cookies blocked, in a partitioned third-party iframe, and once
 * quota is exhausted; and the identifier isn't declared at all outside a browser.
 * All of those are `unavailable`, never an exception out of the SDK.
 */
export function webStore(): SyncStore {
    return {
        sync: true,
        get(key: string): StoreRead {
            try {
                const value = localStorage.getItem(key);
                return value === null ? { status: "miss" } : { status: "hit", value };
            } catch {
                return { status: "unavailable" };
            }
        },
        set(key: string, value: string): StoreWrite {
            try {
                localStorage.setItem(key, value);
                return { status: "ok" };
            } catch {
                return { status: "unavailable" };
            }
        },
        remove(key: string): StoreWrite {
            try {
                localStorage.removeItem(key);
                return { status: "ok" };
            } catch {
                return { status: "unavailable" };
            }
        },
    };
}
