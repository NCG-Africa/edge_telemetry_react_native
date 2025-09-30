import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import path from "path";

export default defineConfig(({ mode }) => ({
    plugins: [
        dts({
            insertTypesEntry: true,
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
                entryFileNames: "[name].js",
                manualChunks: undefined,
                assetFileNames: "assets/[name]-[hash][extname]",
            },
        },
        outDir: "dist",
        sourcemap: true,
    },
}));
