// Platform-agnostic id generator. The web/native split was byte-identical, so it's gone.

/**
 * Wire-contract ids carry a 16-hex-char (64-bit) random segment (§3.3) — except W3C
 * `trace.id`, which is 32 (§6.1). The length is the caller's; the entropy source is not.
 *
 * Entropy is `crypto.getRandomValues`, not `Math.random()` (#91): `device.id` is now
 * persisted, so a collision is *permanent* — two handsets merge into one device row and
 * one rate-limit bucket forever — where a session collision was transient. RN has no
 * WebCrypto of its own; the native entry imports `react-native-get-random-values`
 * (already a dependency) to install it before the first id is minted.
 */
export function randomHex(length = 16): string {
    // Guarded, because the failure is otherwise a bare TypeError thrown from the Telemetry
    // constructor with nothing pointing at the cause. There is no Math.random() fallback on
    // purpose (#91): silently minting weak ids for a value that persists forever is worse
    // than refusing, and the fix is a reinstall, not a retry.
    if (typeof globalThis.crypto?.getRandomValues !== "function") {
        throw new Error(
            "edge-telemetry: crypto.getRandomValues is unavailable, so no id can be minted. " +
            "On React Native this means react-native-get-random-values failed to load — " +
            "reinstall it and rebuild.",
        );
    }
    const bytes = new Uint8Array(Math.ceil(length / 2));
    crypto.getRandomValues(bytes);
    let out = "";
    for (const b of bytes) out += b.toString(16).padStart(2, "0");
    return out.slice(0, length);
}
