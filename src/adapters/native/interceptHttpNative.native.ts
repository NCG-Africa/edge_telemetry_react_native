import { Telemetry } from "../../core/telemetry";
import { patchXHR } from "../xhrIntercept";

/**
 * Captures all JS-originated HTTP on React Native by patching `XMLHttpRequest` — and nothing
 * else. RN's `global.fetch` is `XMLHttpRequest` underneath (contract §4.4), so patching both
 * would emit **two** `http.request` events per `fetch()` call; the one chokepoint catches
 * `fetch` *and* axios, which is why an axios app's HTTP dashboard was empty before #95.
 *
 * Outside the boundary and uncountable: rn-fetch-blob, RN Firebase, native Apollo links,
 * expo-file-system, `Image` loading and `WebSocket` — none of them touch JS HTTP.
 */
export class NetworkTrackerNative {
    private unpatch?: () => void;

    constructor(private telemetry: Telemetry) { }

    public start(): Promise<void> {
        const xhr = (globalThis as any).XMLHttpRequest;
        if (xhr) this.unpatch = patchXHR(this.telemetry, xhr);
        return Promise.resolve();
    }

    /** Restores the original XHR prototype, removing the interception. */
    public stop(): void {
        this.unpatch?.();
        this.unpatch = undefined;
    }
}
