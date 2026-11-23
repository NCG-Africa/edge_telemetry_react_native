// Golden batches (#179, stable goldens #189): every catalogue event this SDK emits, recorded through
// `createTelemetry()` → public API → the real `buildBatch()`, and dumped raw into the gitignored
// `test/raw/`. Nothing here compares: `scripts/conform.sh` runs the processor's `cmd/conform`, which
// checks the batches against the catalogue and derives `test/shape.txt` (event, key, JSON type; no
// values) to compare with the committed one.

import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { buildBatch } from "./adapters/batch";
import type { TelemetryEvent } from "./core/telemetry";

export const RAW_DIR = "test/raw";

/** Writes `batch<suffix>-<i>.json` per batch, after removing this build's files from a prior run. */
export function dumpRaw(batches: TelemetryEvent[][], suffix = ""): void {
    mkdirSync(RAW_DIR, { recursive: true });
    const mine = new RegExp(`^batch${suffix}-\\d+\\.json$`);
    for (const f of readdirSync(RAW_DIR)) if (mine.test(f)) unlinkSync(`${RAW_DIR}/${f}`);
    batches.forEach((events, i) => writeFileSync(`${RAW_DIR}/batch${suffix}-${i}.json`, buildBatch(events)));
}
