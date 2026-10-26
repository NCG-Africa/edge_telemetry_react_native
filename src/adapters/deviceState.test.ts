import { describe, it, expect } from "vitest";
import { batteryAttributes, readOr, isBool } from "./deviceState";

describe("device state (#173)", () => {
  it("battery: 0–1 → int percent; sentinels and junk are omitted, key by key", () => {
    expect(batteryAttributes(0.456, true, false)).toEqual({
      "device.battery_level": 46, "device.battery_charging": true, "device.power_save": false,
    });
    expect(batteryAttributes(-1, undefined, null)).toEqual({});
    expect(batteryAttributes(NaN, "yes", 1)).toEqual({});
    expect(batteryAttributes(1.5, false, undefined)).toEqual({ "device.battery_charging": false });
  });
  it("readOr: a throw, a rejection or an invalid answer is undefined", async () => {
    expect(await readOr(() => true, isBool)).toBe(true);
    expect(await readOr(() => { throw new Error("x"); }, isBool)).toBeUndefined();
    expect(await readOr(() => Promise.reject(new Error("x")), isBool)).toBeUndefined();
    expect(await readOr(() => "true" as any, isBool)).toBeUndefined();
  });
});
