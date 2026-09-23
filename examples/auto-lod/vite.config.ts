import { watchAssets } from "@threenative/assets";
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import config from "./threenative.config.js";

/**
 * Compiles a game's `assets/` into `public/` while the dev server runs — the same seam a
 * scaffolded project uses. Without it this example would serve an uncooked `hull.glb`, whose
 * `TN_discrete_lod` chain the model pass only writes during the cook.
 */
function assetsWatchPlugin(): Plugin {
  return {
    name: "threenative-assets-watch",
    apply: "serve",
    configureServer(server) {
      const handle = watchAssets({ config: config.assets, cwd: server.config.root });
      server.httpServer?.once("close", () => handle.close());
    },
  };
}

export default defineConfig({ plugins: [assetsWatchPlugin()] });
