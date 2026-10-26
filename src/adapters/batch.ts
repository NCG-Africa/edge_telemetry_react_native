import type { TelemetryEvent } from "../core/telemetry";

// v3 wire envelope. Shared by both senders so the web and native POST bodies
// stay byte-identical to the EdgeRum telemetry_batch contract.
export function buildBatch(events: TelemetryEvent[]): string {
    return JSON.stringify({
        type: "telemetry_batch",
        timestamp: new Date().toISOString(),
        batch_size: events.length,
        events,
    });
}

// Auth (#90, contract §11.1). The collector's credentialFromRequest reads Authorization under
// AUTH_MODE=jwt and X-API-Key otherwise — exactly one, never both. Sending both, always, with
// the same value makes one build work in the shared and the segmented (bank / on-prem)
// topologies with no mode flag. Do not sniff the credential's shape to pick a header.
export function buildHeaders(credential: string | undefined): Record<string, string> {
    return {
        "Content-Type": "application/json",
        ...(credential ? { "X-API-Key": credential, "Authorization": `Bearer ${credential}` } : {}),
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
