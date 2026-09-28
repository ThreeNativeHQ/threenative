import { resolve } from "node:path";
import { defineConfig } from "vite";

/** The repository root, so the dev server may serve the adapter this game imports by path. */
const repoRoot = resolve(import.meta.dirname, "..", "..");

export default defineConfig({
  resolve: {
    // The adapter imports `three` beside itself, from its own nested node_modules. Without this a
    // second physical copy enters the graph, `instanceof Bone` stops holding, and the adapter
    // throws "effector is outside the bone hierarchy" against a bone it cannot recognise.
    dedupe: ["three"],
  },
  server: {
    fs: { allow: [repoRoot] },
  },
});
