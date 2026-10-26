import { customValue } from "./userProfile";

/** #167's bounds on one crumb, so 20 of them cannot blow `app.crash`'s budget. */
export const CRUMB_NAME_MAX = 64;
export const CRUMB_DATA_KEYS = 8;

/**
 * A crumb, bounded: `name` capped at 64, the first 8 `data` keys kept, each value by the
 * `user.custom.*` bag rule (primitive as itself, else stringified; capped at 255; dropped if it
 * cannot be stringified). `name` and `timestamp` are set last, so `data` cannot rename the crumb.
 * No `category`, no `level` — a crumb is a name and a little context.
 */
export function boundCrumb(name: unknown, data?: Record<string, unknown>, at: Date = new Date()): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (data && typeof data === "object") {
        for (const [k, v] of Object.entries(data).slice(0, CRUMB_DATA_KEYS)) {
            const value = customValue(v);
            if (value !== undefined) out[k] = value;
        }
    }
    out.name = String(name).slice(0, CRUMB_NAME_MAX);
    out.timestamp = at.toISOString();
    return out;
}

/**
 * Fixed-size ring buffer of recent actions, attached to `app.crash` as the
 * JSON-stringified `crash.breadcrumbs` (last N, oldest evicted first). See #28.
 */
export class BreadcrumbBuffer {
  private items: any[] = [];

  constructor(private max = 20) {}

  add(item: any): void {
    this.items.push(item);
    if (this.items.length > this.max) this.items.shift();
  }

  list(): any[] {
    return [...this.items];
  }

  toJSON(): string {
    return JSON.stringify(this.items);
  }
}
