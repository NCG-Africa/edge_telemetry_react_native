// Platform-agnostic id generator. The web/native split was byte-identical, so it's gone.

/**
 * Wire-contract ids carry a 16-hex-char (64-bit) random segment (§3.3).
 *
 * Entropy is `crypto.getRandomValues`, not `Math.random()` (#91): `device.id` is now
 * persisted, so a collision is *permanent* — two handsets merge into one device row and
 * one rate-limit bucket forever — where a session collision was transient. RN has no
 * WebCrypto of its own; the native entry imports `react-native-get-random-values`
 * (already a dependency) to install it before the first id is minted.
 */
export function randomHex(length = 16): string {
    const bytes = new Uint8Array(Math.ceil(length / 2));
    crypto.getRandomValues(bytes);
    let out = "";
    for (const b of bytes) out += b.toString(16).padStart(2, "0");
    return out.slice(0, length);
}
