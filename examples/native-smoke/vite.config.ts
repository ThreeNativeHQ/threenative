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
    rollupOptions: { output: { codeSplitting: false } },
    target: "es2022",
  },
  define: {
    __TN_PLAYTEST_ENABLED__: JSON.stringify(process.env.THREENATIVE_PLAYTEST_BRIDGE !== "disabled"),
  },
});
