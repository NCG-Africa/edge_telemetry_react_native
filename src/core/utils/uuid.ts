// Platform-agnostic id generator. The web/native split was byte-identical, so it's gone.
// ponytail: Math.random ids are fine for session/user correlation; swap to crypto/uuid
// (e.g. react-native-get-random-values + uuid) here if collision-resistance ever matters.
export function generateId() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}
