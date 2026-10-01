import { fileURLToPath } from "node:url";
import { terrainEditor } from "@threenative/terrain/editor/server";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    terrainEditor({
      documentPath: fileURLToPath(new URL("./terrain/world.json", import.meta.url)),
    }),
  ],
  server: { host: "127.0.0.1" },
  optimizeDeps: { exclude: ["@threenative/terrain/editor"] },
});
