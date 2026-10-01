import { fileURLToPath } from "node:url";
import { terrainEditor } from "@threenative/terrain/editor/server";
import { defineConfig } from "vite";

export default defineConfig({
  // The starter PBR sets are the terrain package's prepared art, served to the game rather than
  // duplicated into this example's `public/`: `/leafy_grass/…` reaches the same bytes in dev and in
  // a build, and `ctx.assets` loads them by that path.
  publicDir: fileURLToPath(new URL("../../packages/terrain/starter-assets", import.meta.url)),
  plugins: [
    terrainEditor({
      documentPath: fileURLToPath(new URL("./terrain/world.json", import.meta.url)),
    }),
  ],
  server: { host: "127.0.0.1" },
  optimizeDeps: { exclude: ["@threenative/terrain/editor"] },
});
