import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  build: {
    emptyOutDir: true,
    outDir: "../../artifacts/velocity-fixture",
    rollupOptions: { input: fileURLToPath(new URL("velocity.html", import.meta.url)) },
  },
});
