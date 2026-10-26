import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { gzipSync } from "node:zlib";
import { transformSync } from "esbuild";

// #158 / #151 — "lightweight" as a checked claim. Per entry, over the full chunk graph rollup
// emitted, esbuild-minified (the ESM output is unminified; the consumer's bundler minifies) and
// gzipped. esbuild ships with vite, so this adds no dependency.
//
// Measured at #158 (gz): native 15.1 KB, web 22.1 KB; at v5's #174: native 19.9 KB, web 25.5 KB. v4 was native 23.7 KB, 8.5 KB of it the
// three native-module packages now externalized.
const CAP_KB = { "index.native.js": 20, "index.web.js": 26 } as const;
const EXTERNALIZED = ["react-native-device-info", "@react-native-community/netinfo", "react-native-get-random-values"];

const DIST = join(__dirname, "..", "dist");

/** Every chunk reachable from an entry — static `from "./…"` and dynamic `import("./…")`. */
function reachable(entry: string): string[] {
    const seen = new Set<string>();
    const walk = (file: string) => {
        if (seen.has(file) || !existsSync(file)) return;
        seen.add(file);
        for (const m of readFileSync(file, "utf8").matchAll(/["'](\.[^"']+?\.js)["']/g)) {
            walk(join(dirname(file), m[1]));
        }
    };
    walk(entry);
    return [...seen];
}

const gzKB = (files: string[]) => gzipSync(
    files.map(f => transformSync(readFileSync(f, "utf8"), { minify: true, format: "esm" }).code).join("\n"),
    { level: 9 },
).length / 1024;

describe("size budget (§5, #158)", () => {
    it.each(Object.entries(CAP_KB))("%s is at or under %s KB gz", (entry, cap) => {
        const built = join(DIST, entry);
        expect(existsSync(built), `run \`npm run build\` first — ${built} is missing`).toBe(true);
        const kb = gzKB(reachable(built));
        expect(kb, `${entry} is ${kb.toFixed(1)} KB gz, cap ${cap} KB`).toBeLessThanOrEqual(cap);
    });

    it("the native graph carries no copy of the externalized native-module packages", () => {
        // The sourcemaps name every original file a chunk was built from, so a bundled copy
        // shows up as a `node_modules/<pkg>/` source — exact, where grepping the code is not
        // (core's own error message names `react-native-get-random-values`).
        for (const f of reachable(join(DIST, "index.native.js"))) {
            const { sources } = JSON.parse(readFileSync(`${f}.map`, "utf8")) as { sources: string[] };
            for (const pkg of EXTERNALIZED) {
                expect(sources.filter(src => src.includes(`node_modules/${pkg}/`)), f).toEqual([]);
            }
        }
    });
});
