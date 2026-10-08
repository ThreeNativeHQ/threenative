import { defineConfig } from "vite";

// Two pages: the core game (index.html) and three alone on the Wasm renderer (renderer.html).
export default defineConfig({
  // Unminified so an engine refusal names the call site that reached it.
  build: { minify: false, rollupOptions: { input: ["index.html", "renderer.html"] } },
});
