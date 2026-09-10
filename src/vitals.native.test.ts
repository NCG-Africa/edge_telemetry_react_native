import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import type { TelemetryEvent } from "./core/telemetry";

// #106 / §5.3 — the native half of the vitals contract is an **absence**, and it earns two
// assertions rather than a sentence in a doc: `web-vitals` must not reach the native bundle,
// and `TelemetryNative` must never land a vital on the wire.

const platform = vi.hoisted(() => ({ OS: "android" }));
vi.mock("react-native", () => ({
    Platform: platform,
    AppState: { currentState: "active", addEventListener: () => { } },
}));
vi.mock("react-native-device-info", () => ({
    default: new Proxy({}, { get: () => async () => "x" }),
}));
vi.mock("@react-native-community/netinfo", () => ({
    default: { fetch: async () => ({ type: "wifi", isConnected: true }), addEventListener: () => { } },
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
    default: { getItem: async () => null, setItem: async () => { }, removeItem: async () => { } },
}));

afterEach(() => vi.restoreAllMocks());

const DIST = join(__dirname, "..", "dist");
const ROOT = join(__dirname, "..");

/**
 * Every chunk reachable from an entry, following the relative specifiers rollup emitted.
 * Chunk *names* are what the assertion reads: a `web-vitals` chunk in this set would be
 * bytes a native consumer ships.
 */
function reachable(entry: string): Set<string> {
    const seen = new Set<string>();
    const walk = (file: string) => {
        if (seen.has(file) || !existsSync(file)) return;
        seen.add(file);
        const src = readFileSync(file, "utf8");
        for (const m of src.matchAll(/["'](\.[^"']+?\.(?:js|cjs))["']/g)) {
            walk(join(dirname(file), m[1]));
        }
    };
    walk(entry);
    return seen;
}

describe("web-vitals ships zero bytes to native (§5.3)", () => {
    // The built output, not the source graph — `npm ci` runs `prepare`, so `dist/` exists
    // before `npm test` in CI and after any local install.
    it.each(["index.native.js", "index.native.cjs"])("%s reaches no web-vitals chunk", (entry) => {
        const built = join(DIST, entry);
        expect(existsSync(built), `run \`npm run build\` first — ${built} is missing`).toBe(true);

        const chunks = [...reachable(built)].map(f => f.slice(DIST.length + 1));
        expect(chunks.filter(c => /web-?vitals/i.test(c))).toEqual([]);
        for (const c of chunks) {
            expect(readFileSync(join(DIST, c), "utf8")).not.toContain("web-vitals");
        }
    });

    it("reaches it from the web entry — the dependency is bundled, not externalized", () => {
        const chunks = [...reachable(join(DIST, "index.web.js"))].map(f => f.slice(DIST.length + 1));
        expect(chunks.some(c => /web-?vitals/i.test(c))).toBe(true);
    });

    it("is a bundled dependency, never a peer — consumers install nothing", () => {
        const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
        expect(pkg.dependencies["web-vitals"]).toBeDefined();
        expect(pkg.peerDependencies?.["web-vitals"]).toBeUndefined();
        // The bundler's externalization is an explicit allowlist; `web-vitals` on it would
        // turn a bundled dependency into one every consumer has to install.
        expect(readFileSync(join(ROOT, "vite.config.ts"), "utf8")).not.toContain("web-vitals");
    });
});

describe("TelemetryNative emits no vital, ever (§5.3)", () => {
    it("lands no LCP/FCP/CLS/INP/TTFB on the wire across a full lifecycle", async () => {
        vi.spyOn(console, "log").mockImplementation(() => { });
        vi.spyOn(console, "warn").mockImplementation(() => { });
        const { createTelemetry } = await import("./createTelemetry.native");

        const sent: TelemetryEvent[] = [];
        const t = createTelemetry({
            apiKey: "edge_k", endpoint: "https://x/telemetry",
            sender: { send: async (e: TelemetryEvent[]) => { sent.push(...e); } },
            batchSize: 500, flushIntervalMs: 0,
        });
        const inst: any = await (t as any).instancePromise;
        await inst.views.background();      // the boundary web drains CLS/INP at
        await t.log("custom_event");
        await t.flush();

        const vitals = ["LCP", "FCP", "CLS", "INP", "TTFB"];
        expect(sent.filter(e => vitals.includes(e.metricName ?? ""))).toEqual([]);
        expect((t as any).trackWebVitals).toBeUndefined();
    });
});
