import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AsyncStore, StoreRead, StoreWrite } from "../../core/store";

/**
 * AsyncStorage-backed Store for the native build (#89). Reads settle later, so a
 * caller cannot assume a write has landed before the process dies — the crash-loss
 * window narrows here, it does not close. The port keeps that visible.
 *
 * A rejected AsyncStorage call — no native module linked, SQLite/disk full — is
 * `unavailable`, distinct from a key that simply isn't there.
 */
export function nativeStore(): AsyncStore {
    return {
        sync: false,
        async get(key: string): Promise<StoreRead> {
            try {
                const value = await AsyncStorage.getItem(key);
                return value === null || value === undefined
                    ? { status: "miss" }
                    : { status: "hit", value };
            } catch {
                return { status: "unavailable" };
            }
        },
        async set(key: string, value: string): Promise<StoreWrite> {
            try {
                await AsyncStorage.setItem(key, value);
                return { status: "ok" };
            } catch {
                return { status: "unavailable" };
            }
        },
        async remove(key: string): Promise<StoreWrite> {
            try {
                await AsyncStorage.removeItem(key);
                return { status: "ok" };
            } catch {
                return { status: "unavailable" };
            }
        },
    };
}
