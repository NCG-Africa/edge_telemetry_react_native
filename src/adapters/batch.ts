import type { TelemetryEvent } from "../core/telemetry";

/**
 * The catalogue's contract version this build speaks (#179, processor #29). Only the major gates
 * parsing; the minor follows the catalogue tag pinned in `catalogue.version`.
 */
export const CONTRACT_VERSION = "4.3.0";

/**
 * Per-event identity copies the Context block stamps and the envelope lifts to its root
 * (processor #29). Tier A in `beforeSend` (`device.id` Tier B), so a hook cannot delete the
 * envelope out from under the batch. `sdk.platform` has no envelope slot: `sdk.name` +
 * `app.platform` carry it.
 */
const IDENTITY = ["device.id", "app.name", "app.package_name", "app.version", "app.build_number", "sdk.version", "sdk.platform"];

const identityOf = (e: TelemetryEvent) => JSON.stringify(IDENTITY.map(k => e.attributes?.[k]));

/**
 * The 8-key 4.x envelope (`envelope.yaml`), shared by both senders so the web and native POST
 * bodies stay byte-identical. Identity comes from the rows themselves, so a batch persisted by
 * a prior launch replays under that launch's `app` block. Every row of one batch shares it:
 * the live queue has one identity per process, and `byIdentity()` splits a replayed one.
 */
export function buildBatch(events: TelemetryEvent[]): string {
    const a = events[0]?.attributes ?? {};
    return JSON.stringify({
        type: "telemetry_batch",
        contract_version: CONTRACT_VERSION,
        timestamp: new Date().toISOString(),
        batch_size: events.length,
        device_id: a["device.id"],
        sdk: { name: "react_native", version: a["sdk.version"] },
        app: {
            name: a["app.name"],
            package_name: a["app.package_name"],
            platform: a["device.platform"],
            version: a["app.version"],
            build_number: a["app.build_number"],
        },
        events: events.map(e => {
            const attributes = { ...e.attributes };
            for (const k of IDENTITY) delete attributes[k];
            return { ...e, attributes };
        }),
    });
}

/** Rows grouped by identity, first-seen order — one envelope per group on replay. */
export function byIdentity(events: TelemetryEvent[]): TelemetryEvent[][] {
    const groups = new Map<string, TelemetryEvent[]>();
    for (const e of events) {
        const k = identityOf(e);
        groups.set(k, [...(groups.get(k) ?? []), e]);
    }
    return [...groups.values()];
}

/**
 * Replay a recovered queue, one POST per identity. On a failure the unsent rows go back to the
 * store — minus the failed group itself when it was rejected (§2.5: a 4xx is dropped, never kept).
 */
export async function replayGroups(
    stored: TelemetryEvent[],
    post: (events: TelemetryEvent[]) => Promise<void>,
    persist: (events: TelemetryEvent[]) => unknown,
): Promise<void> {
    const groups = byIdentity(stored);
    for (let i = 0; i < groups.length; i++) {
        try {
            await post(groups[i]);
        } catch (err) {
            const rest = groups.slice(isRejected(err) ? i + 1 : i).flat();
            if (rest.length > 0) await persist(rest);
            throw err;
        }
    }
}

// Auth (processor #29): `X-API-Key` only. 4.x drops `Authorization: Bearer`.
export function buildHeaders(credential: string | undefined): Record<string, string> {
    return {
        "Content-Type": "application/json",
        ...(credential ? { "X-API-Key": credential } : {}),
    };
}

/**
 * A non-2xx the senders refuse to retry (§2.5): any 4xx, 429 included. `resetAt` is the epoch
 * ms `X-RateLimit-Reset` names, when the collector sent one. Core reads `status` by shape, so
 * a consumer's own sender can throw `{ status: 401 }` and get the same handling.
 */
export class HttpStatusError extends Error {
    constructor(public readonly status: number, public readonly resetAt?: number) {
        super(`Telemetry send failed: ${status}`);
    }
}

/** The status a send failed with, when it failed with one; `undefined` for network and the rest. */
export function statusOf(err: unknown): number | undefined {
    const s = (err as any)?.status;
    return typeof s === "number" ? s : undefined;
}

/** 4xx except 429: drop the batch — no retry, no persist (§2.5). */
export const isRejected = (err: unknown) => { const s = statusOf(err); return s !== undefined && s >= 400 && s < 500 && s !== 429; };

/**
 * `X-RateLimit-Reset` as epoch ms. The header is read both ways in the wild — epoch seconds or
 * seconds-from-now — and the magnitude tells them apart: anything past 2001 is a timestamp.
 */
function resetAtOf(headers: any, now = Date.now()): number | undefined {
    const raw = Number(headers?.get?.("x-ratelimit-reset"));
    if (!Number.isFinite(raw) || raw < 0) return undefined;
    return raw > 1e9 ? raw * 1000 : now + raw * 1000;
}

type PostResult = { ok: boolean; status: number; headers?: any };

/**
 * Retry + backoff, shared by both senders so the §2.5 status table is one rule. 5xx and network
 * errors retry; a 4xx — 429 included — throws at once, because retrying a wrong credential three
 * times only delays the drop and retrying a 429 is the stampede the header exists to stop.
 */
export async function sendWithRetry(post: () => Promise<PostResult>, retryCount: number, backoffMs: (attempt: number) => number) {
    let lastError: unknown;
    for (let attempt = 1; attempt <= retryCount; attempt++) {
        try {
            const res = await post();
            if (res.ok) return;
            const err = new HttpStatusError(res.status, res.status === 429 ? resetAtOf(res.headers) : undefined);
            if (res.status >= 400 && res.status < 500) throw err;
            lastError = err;
        } catch (err) {
            if (statusOf(err) !== undefined && statusOf(err)! < 500) throw err;
            lastError = err;
        }
        if (attempt < retryCount) await new Promise(r => setTimeout(r, backoffMs(attempt)));
    }
    throw lastError;
}

// Placeholder host — always pass a real `endpoint`. The path is the collector's real one:
// it terminates POST /telemetry (contract §11.1). Shared so the two senders cannot drift.
export const DEFAULT_ENDPOINT = "https://your.telemetry.endpoint/telemetry";
