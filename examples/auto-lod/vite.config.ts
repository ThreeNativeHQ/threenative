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
    async configureServer(server) {
      const handle = watchAssets({ config: config.assets, cwd: server.config.root });
      server.httpServer?.once("close", () => handle.close());
      // Nothing is served before the first cook settles: until it does, `public/` has no
      // `assets.manifest.json` and every asset answers from its source fallback.
      await handle.ready;
    },
  };
}

export default defineConfig({ plugins: [assetsWatchPlugin()] });
