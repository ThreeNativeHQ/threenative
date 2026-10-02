import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { terrainEditor } from "@threenative/terrain/editor/server";
import { type Plugin, defineConfig } from "vite";

/**
 * The game's own licensed art, served beside the starter's.
 *
 * `publicDir` is one directory, and it is already the terrain package's CC0
 * starter sets. The prepared Fab pines are this example's own art, they are
 * licensed and cannot be committed, and they live in a gitignored folder that
 * only exists on the machine that ran `scripts/prep-fab-pines.py` — so they are
 * a second static root rather than a copy of the first.
 *
 * A missing directory is not an error: the loader in `src/render/prepared.ts`
 * treats a refused model as "this game has no prepared art" and draws the
 * procedural spruce instead, which is what CI gets.
 */
function preparedAssets(): Plugin {
  const root = fileURLToPath(new URL("./local-assets/prepared", import.meta.url));
  const types: Record<string, string> = {
    ".glb": "model/gltf-binary",
    ".jpg": "image/jpeg",
    ".png": "image/png",
  };
  const serve = (server: {
    middlewares: {
      use: (
        route: string,
        handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void,
      ) => void;
    };
  }) => {
    server.middlewares.use("/prepared", (request, response, next) => {
      const name = (request.url ?? "").split("?")[0]?.replace(/^\/+/, "") ?? "";
      // A path segment can only be a name: the resolver is flattened and refuses
      // anything with a separator in it, so a crafted URL cannot walk out of the
      // folder and read the licensed originals sitting beside it.
      const path =
        name === "" || name.includes("/") || name.includes("..") ? undefined : `${root}/${name}`;
      if (path === undefined || !existsSync(path) || !statSync(path).isFile()) {
        next();
        return;
      }
      response.setHeader(
        "content-type",
        types[name.slice(name.lastIndexOf("."))] ?? "application/octet-stream",
      );
      response.setHeader("cache-control", "no-cache");
      createReadStream(path).pipe(response);
    });
  };
  return {
    name: "strata-prepared-assets",
    configureServer: serve,
    configurePreviewServer: serve,
  };
}

export default defineConfig({
  // The starter PBR sets are the terrain package's prepared art, served to the game rather than
  // duplicated into this example's `public/`: `/leafy_grass/…` reaches the same bytes in dev and in
  // a build, and `ctx.assets` loads them by that path.
  publicDir: fileURLToPath(new URL("../../packages/terrain/starter-assets", import.meta.url)),
  plugins: [
    terrainEditor({
      documentPath: fileURLToPath(new URL("./terrain/world.json", import.meta.url)),
    }),
    preparedAssets(),
  ],
  server: { host: "127.0.0.1" },
  optimizeDeps: { exclude: ["@threenative/terrain/editor"] },
});
