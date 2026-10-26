// Manual spans (#164) — the bookkeeping half, shared by both builds: which spans are open,
// the bounds, supersede-by-name, and the persisted shape. Core owns the trace keys, the
// identity freeze and the `task.complete` emit; nothing here touches either.

import { stringifyOrDrop } from "../core/utils/json";
import type { TraceAttributes } from "./traceManager";

/** A leak in host code must not grow without bound. Internal, never `TelemetryOpts`. */
export const MAX_OPEN_SPANS = 32;
const TASK_NAME_MAX = 255;

export type TaskOutcome = "completed" | "failed" | "abandoned";

export type OpenSpan = {
    name: string;
    start: number;
    attrs?: Record<string, unknown>;
    /** Frozen at start (§3.1). Unset only while a start waits on an expired session's rotation. */
    keys?: TraceAttributes;
    viewId?: string;
    sessionId?: string;
    sessionStart?: number;
    /** That rotation — an end arriving before it settles waits on it. */
    ready?: Promise<void>;
};

/** The persisted form: identity frozen, attributes as a JSON string so a cycle cannot break the record. */
export type PersistedSpan = Omit<OpenSpan, "attrs" | "ready"> & { attrs?: string };

/**
 * Attributes a span carries can annotate but never forge the join keys: anything in the
 * `task`, `span`, `trace`, `parent` or `rum` namespaces is dropped, flattened or not.
 * Identity keys need no filter — core assembles them after caller data.
 */
const RESERVED = /^(task|span|trace|parent|rum)(\.|$)/;
export function spanAttributes(attrs: unknown): Record<string, unknown> | undefined {
    if (!attrs || typeof attrs !== "object") return undefined;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(attrs)) if (!RESERVED.test(k)) out[k] = v;
    return out;
}

/** Unnormalized and capped at 255; blank or non-string is inert (`undefined`). */
export function taskName(name: unknown): string | undefined {
    return typeof name === "string" && name.trim() !== "" ? name.slice(0, TASK_NAME_MAX) : undefined;
}

export class SpanRegistry {
    private open = new Map<string, OpenSpan>();

    /**
     * Opens `name`, superseding an open span of the same name — dropped without a row, since
     * `abandoned` means "the session ended first" and nothing else. `undefined` past the cap.
     */
    start(name: string, start: number, attrs?: Record<string, unknown>): OpenSpan | undefined {
        if (!this.open.has(name) && this.open.size >= MAX_OPEN_SPANS) return undefined;
        const span: OpenSpan = { name, start, attrs };
        this.open.delete(name);
        this.open.set(name, span);
        return span;
    }

    /** Close by name. With `only`, a superseded handle cannot close its successor. */
    take(name: string, only?: OpenSpan): OpenSpan | undefined {
        const span = this.open.get(name);
        if (!span || (only && span !== only)) return undefined;
        this.open.delete(name);
        return span;
    }

    /** `disable()` (#172): an opt-out keeps nothing, open journeys included. */
    clear(): void {
        this.open.clear();
    }

    has(span: OpenSpan): boolean {
        return this.open.get(span.name) === span;
    }

    /** Every span frozen to `sessionId`, removed — the ones a finalize owes `abandoned`. */
    takeSession(sessionId: string): OpenSpan[] {
        const out = [...this.open.values()].filter((s) => s.sessionId === sessionId);
        for (const s of out) this.open.delete(s.name);
        return out;
    }

    toJSON(): PersistedSpan[] {
        return [...this.open.values()]
            .filter((s) => s.sessionId !== undefined)
            .map(({ ready: _r, attrs, ...s }) => ({ ...s, attrs: attrs && stringifyOrDrop(attrs) }));
    }

    /** Adopt a persisted record's spans. Anything malformed is skipped, never thrown. */
    restore(saved: unknown): void {
        this.open.clear();
        if (!Array.isArray(saved)) return;
        for (const s of saved.slice(0, MAX_OPEN_SPANS)) {
            if (typeof s?.name !== "string" || typeof s.start !== "number" || typeof s.sessionId !== "string") continue;
            let attrs: Record<string, unknown> | undefined;
            try { attrs = s.attrs ? JSON.parse(s.attrs) : undefined; } catch { attrs = undefined; }
            this.open.set(s.name, { ...s, attrs });
        }
    }
}
