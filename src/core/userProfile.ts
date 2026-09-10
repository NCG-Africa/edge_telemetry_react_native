// §4.10, #107 — the profile attributes for `user.profile.update`, and nothing else.
//
// PII used to ride the Context block of every event: a 10,000-event session put 10,000
// copies of an email address on the wire and at rest. It now appears on the one event
// that needs it, keyed by `user.id` (which `identify({ userId })` sets).
//
// The bag rule here retires three v3 defects at once — `flattenWithPrefix` had no depth
// guard, so a cyclic `customAttributes` value recursed to a `RangeError` *inside the SDK*
// and crashed the host app on a bad `identify()`; arrays passed through raw against the
// primitive-values rule; and nested objects recursed into the bag. A bad payload is a
// dropped key, never a throw.

import { isDev } from "./debug";
import { stringifyOrDrop } from "./utils/json";
import type { UserProfile } from "./telemetry";

// Backend column widths (§4.10, work-list item 14). `rum_users.phone` is VARCHAR(50).
export const NAME_CAP = 255;
export const EMAIL_CAP = 255;
export const PHONE_CAP = 50;
export const CUSTOM_MAX_KEYS = 64;
export const CUSTOM_KEY_CAP = 64;
export const CUSTOM_VALUE_CAP = 255;

let warnedOnce = false;

function capString(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.slice(0, max);
  return trimmed.length ? trimmed : undefined;
}

/**
 * A primitive rides as itself; anything else is stringified and truncated. A value that
 * cannot be stringified — a cycle, a throwing `toJSON` — drops the key rather than the
 * process. Consumer keys pass through **verbatim, casing included** (§4.10): the SDK
 * imposes no normalization here, so an over-long key is dropped, never truncated.
 */
function customValue(value: unknown): string | number | boolean | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.slice(0, CUSTOM_VALUE_CAP) || undefined;
  const flat = stringifyOrDrop(value);
  return flat === undefined ? undefined : flat.slice(0, CUSTOM_VALUE_CAP) || undefined;
}

/**
 * The wire keys for `user.profile.update`. `user.id` is not here — it rides the Context
 * block, where it is present on this event by construction.
 */
export function buildProfileAttributes(profile: UserProfile | undefined): Record<string, any> {
  const attrs: Record<string, any> = {};
  if (!profile) return attrs;

  const name = capString(profile.fullName, NAME_CAP);
  const email = capString(profile.email, EMAIL_CAP);
  const phone = capString(profile.phone, PHONE_CAP);
  if (name !== undefined) attrs["user.name"] = name;
  if (email !== undefined) attrs["user.email"] = email;
  if (phone !== undefined) attrs["user.phone"] = phone;

  let dropped = 0;
  let kept = 0;
  for (const key of Object.keys(profile.customAttributes || {})) {
    if (key.length > CUSTOM_KEY_CAP || kept >= CUSTOM_MAX_KEYS) { dropped++; continue; }
    const value = customValue((profile.customAttributes as any)[key]);
    if (value === undefined) { dropped++; continue; }
    attrs[`user.custom.${key}`] = value;
    kept++;
  }

  if (dropped > 0) {
    attrs["user.custom_dropped"] = dropped;
    if (isDev() && !warnedOnce) {
      warnedOnce = true;
      console.warn(
        `[edge-telemetry] identify(): ${dropped} custom attribute(s) dropped. ` +
        `user.custom.* is bounded at ${CUSTOM_MAX_KEYS} keys, ${CUSTOM_KEY_CAP}-char keys ` +
        `and ${CUSTOM_VALUE_CAP}-char values; unserializable values are dropped.`
      );
    }
  }

  return attrs;
}
