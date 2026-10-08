import { createWebEnginePlugin } from "create-threenative";
import { defineConfig } from "vite";
import config from "./threenative.config.js";

// Two pages: the core game (index.html) and three alone on the Wasm renderer (renderer.html).
export default defineConfig({
  // As every template lists it: `pnpm dev` follows the config's engine too.
  plugins: [createWebEnginePlugin({ engine: config.engine })],
  // Unminified so an engine refusal names the call site that reached it.
  // WASM_BOOT_PAGES=renderer builds the three-only page alone, while core cannot bundle on the
  // engine yet (PRD-540 phase 2 box 2).
  build: {
    minify: false,
    rollupOptions: {
      input:
        process.env.WASM_BOOT_PAGES === "renderer"
          ? ["renderer.html"]
          : ["index.html", "renderer.html"],
    },
  },
});
