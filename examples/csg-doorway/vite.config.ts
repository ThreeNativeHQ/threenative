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
    configureServer(server) {
      const handle = watchAssets({ config: config.assets, cwd: server.config.root });
      server.httpServer?.once("close", () => handle.close());
    },
  };
}

export default defineConfig({ plugins: [assetsWatchPlugin()] });
