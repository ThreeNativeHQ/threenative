import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: resolve(import.meta.dirname, "src/main.ts"),
      fileName: () => "native-smoke.js",
      formats: ["es"],
    },
    minify: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
    target: "es2022",
  },
});
