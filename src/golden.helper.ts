// Golden batches (#179, processor #40): every catalogue event this SDK emits, recorded through
// `createTelemetry()` → public API → the real `buildBatch()`, one file per event under
// `test/golden/`. `scripts/conform.sh` runs the processor's `cmd/conform` on that directory at the
// tag pinned in `catalogue.version`.
//
// Per-run values (ids, timestamps, durations, stacks) are normalized to a fixed value of the same
// JSON type, so a golden pins names, keys and types. Regenerate with:
//
//   UPDATE_GOLDENS=1 npx vitest run src/golden

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { buildBatch } from "./adapters/batch";
import type { TelemetryEvent } from "./core/telemetry";

export const GOLDEN_DIR = "test/golden";
const TS = "2026-01-01T00:00:00.000Z";

const VOLATILE = new Set([
    "session.id", "user.id", "view.id", "trace.id", "span.id", "parent.span.id", "rum.action.id",
    "error.stacktrace", "error.breadcrumbs", "error.component_stack", "device.platform_version",
    "device.model", // web reads the runtime: "Node.js/<major>" differs between a dev machine and CI
]);

function normalize(key: string, v: unknown): unknown {
    if (typeof v === "number") return Number.isInteger(v) ? 1 : 1.5;
    if (typeof v !== "string") return v;
    if (/^\d{4}-\d\d-\d\dT/.test(v)) return TS;
    return VOLATILE.has(key) ? `<${key}>` : v;
}

function normalizeEvent(e: any) {
    const attributes = Object.fromEntries(
        Object.keys(e.attributes ?? {}).sort().map((k) => [k, normalize(k, e.attributes[k])]),
    );
    return { ...e, timestamp: TS, ...(e.value === undefined ? {} : { value: 1.5 }), attributes };
}

/**
 * One golden per event name holding every distinct variant of it, sorted, so the file does not
 * depend on emit order. `suffix` keeps one build's files apart from the other's.
 */
export function goldens(batches: TelemetryEvent[][], suffix = ""): Record<string, string> {
    const variants: Record<string, Set<string>> = {};
    const envelopes: Record<string, any> = {};
    mkdirSync("test/raw", { recursive: true }); // PROTOTYPE #90: raw batches, gitignored
    for (const [i, events] of batches.entries()) {
        const raw = buildBatch(events);
        writeFileSync(`test/raw/batch${suffix}-${i}.json`, raw);
        const batch = JSON.parse(raw);
        for (const e of batch.events) {
            const file = `${(e.eventName ?? e.metricName).replace(/\./g, "-")}${suffix}.json`;
            envelopes[file] = batch;
            (variants[file] ??= new Set()).add(JSON.stringify(normalizeEvent(e)));
        }
    }
    return Object.fromEntries(Object.entries(variants).map(([file, items]) => {
        const events = [...items].sort().map((s) => JSON.parse(s));
        const env = envelopes[file];
        const out = { ...env, timestamp: TS, batch_size: events.length, device_id: "<device_id>", events };
        return [file, JSON.stringify(out, null, 2) + "\n"];
    }));
}

/** The files this build owns on disk; with UPDATE_GOLDENS set, rewritten from `fresh` first. */
export function syncGoldens(fresh: Record<string, string>, owns: (file: string) => boolean): Record<string, string> {
    if (process.env.UPDATE_GOLDENS) {
        mkdirSync(GOLDEN_DIR, { recursive: true });
        for (const f of readdirSync(GOLDEN_DIR)) if (owns(f)) unlinkSync(`${GOLDEN_DIR}/${f}`);
        for (const [f, json] of Object.entries(fresh)) writeFileSync(`${GOLDEN_DIR}/${f}`, json);
    }
    if (!existsSync(GOLDEN_DIR)) return {};
    return Object.fromEntries(readdirSync(GOLDEN_DIR).filter(owns)
        .map((f) => [f, readFileSync(`${GOLDEN_DIR}/${f}`, "utf8")]));
}
