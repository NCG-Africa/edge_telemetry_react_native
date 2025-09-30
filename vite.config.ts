import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import path from "path";

export default defineConfig({
    plugins: [
        dts({
            insertTypesEntry: true,
        }),
    ],
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
            // mark only externals as external, bundle everything else
            external: [
                "react",
                "react-dom",
                "@react-native-async-storage/async-storage",
            ],
            output: {
                entryFileNames: "[name].js",
                // 🚀 ensure one file per entry (no extra chunks)
                manualChunks: undefined,
                assetFileNames: "assets/[name]-[hash][extname]",
            },
        },
        outDir: "dist",
        sourcemap: true,
    },
});
