import tailwindcss from "@tailwindcss/vite";
import { watchAssets } from "@threenative/assets";
import react from "@vitejs/plugin-react";
import { createWebBrandPlugin } from "create-threenative";
import { defineConfig } from "vite";
import type { Plugin } from "vite";

/**
 * Recompiles assets/ into public/ while the dev server runs, so editing a texture does not
 * need a rebuild. Serve-only by declaration: builds compile through `threenative build`.
 */
function assetsWatchPlugin(): Plugin {
  return {
    name: "threenative-assets-watch",
    apply: "serve",
    configureServer(server) {
      const handle = watchAssets({ cwd: server.config.root });
      server.httpServer?.once("close", () => handle.close());
    },
  };
}

export default defineConfig({
  plugins: [createWebBrandPlugin(), react(), tailwindcss(), assetsWatchPlugin()],
  server: {
    watch: {
      ignored: ["**/artifacts/**", "**/screenshots/**", "**/playtests/**"],
      usePolling: true,
    },
  },
});
