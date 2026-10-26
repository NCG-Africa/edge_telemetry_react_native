// #173's device state (decision #149) — the pure half, shared by both builds: what counts as a
// real reading. Each build's adapter only does the platform reads.

/** A failure row's battery keys, or none. `-1` (simulator), non-finite or out of range → omitted. */
export function batteryAttributes(level: unknown, charging: unknown, powerSave: unknown): Record<string, number | boolean> {
    const out: Record<string, number | boolean> = {};
    if (typeof level === "number" && Number.isFinite(level) && level >= 0 && level <= 1) {
        out["device.battery_level"] = Math.round(level * 100);
    }
    if (typeof charging === "boolean") out["device.battery_charging"] = charging;
    if (typeof powerSave === "boolean") out["device.power_save"] = powerSave;
    return out;
}

/**
 * One read, settled to a value or `undefined` — a throw, a rejection, a missing method or a
 * non-boolean/non-finite answer all omit that one key, never the others.
 */
export async function readOr<T>(read: () => T | Promise<T>, valid: (v: unknown) => boolean): Promise<T | undefined> {
    try {
        const v = await read();
        return valid(v) ? v : undefined;
    } catch {
        return undefined;
    }
}

export const isBool = (v: unknown) => typeof v === "boolean";
export const isFiniteNumber = (v: unknown) => typeof v === "number" && Number.isFinite(v);
