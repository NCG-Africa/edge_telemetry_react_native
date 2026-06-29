// Platform-agnostic id generator. The web/native split was byte-identical, so it's gone.
// ponytail: Math.random ids are fine for session/user correlation; swap to crypto/uuid
// (e.g. react-native-get-random-values + uuid) here if collision-resistance ever matters.
export function generateId() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// v3 wire contract: ids carry a 16-hex-char (64-bit) random segment.
// ponytail: Math.random hex is fine for session/user correlation; swap to
// crypto/SecRandom here if collision-resistance ever matters.
export function randomHex(length = 16): string {
    let out = "";
    for (let i = 0; i < length; i++) out += Math.floor(Math.random() * 16).toString(16);
    return out;
}
