import { watchAssets } from "@threenative/assets";
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import config from "./threenative.config.js";

// Compiles the game's `assets/` into `public/` while the dev server runs — the same seam a
// scaffolded project uses. `doorway.glb` is an already-authored source; the cook is the ordinary
// one, so a browser run exercises the same route the desktop and Android builds do.
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
