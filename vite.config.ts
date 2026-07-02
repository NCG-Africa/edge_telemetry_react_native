import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import path from "path";

export default defineConfig(({ mode }) => ({
    plugins: [
        dts({
            insertTypesEntry: true,
            exclude: ["**/*.test.ts", "**/*.test.tsx"],
        }),
    ],
    resolve: {
        extensions: [".web.ts", ".web.js", ".ts", ".js", ".json"],
        alias: {
            ...(process.env.BUILD_TARGET === "web"
                ? {
                    // 👇 Only apply for web builds
                    "react-native": path.resolve(
                        __dirname,
                        "src/shims/react-native-web-shim.ts"
                    ),
                }
                : {}),
        },
    },
    build: {
        lib: {
            entry: {
                "index.web": path.resolve(__dirname, "src/index.web.ts"),
                "index.native": path.resolve(__dirname, "src/index.native.ts"),
            },
            name: "ReactTelemetryLib",
            formats: ["es", "cjs"],
        },
        rollupOptions: {
            external: [
                "react",
                "react-dom",
                "@react-native-async-storage/async-storage",
                "react-native"
            ],
            output: {
                // Let Vite pick per-format extensions (es → .js, cjs → .cjs under
                // "type":"module") so both entry builds are emitted instead of clobbering
                // each other on a shared [name].js. Matches the package.json exports map.
                manualChunks: undefined,
                assetFileNames: "assets/[name]-[hash][extname]",
            },
        },
        outDir: "dist",
        sourcemap: true,
    },
}));
