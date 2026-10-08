import { defineConfig } from "vite";

// Two pages: the core game (index.html) and three alone on the Wasm renderer (renderer.html).
export default defineConfig({
  build: { rollupOptions: { input: ["index.html", "renderer.html"] } },
});
