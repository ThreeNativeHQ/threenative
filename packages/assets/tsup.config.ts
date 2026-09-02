import { defineConfig } from "tsup";

export default defineConfig({
  // apply-worker is the bounded pool's child entry: worker-pool.ts points at the emitted
  // neighbour file when the compile itself is compiled, so it ships as its own chunk.
  entry: ["src/index.ts", "src/apply-worker.ts"],
  format: ["esm"],
  target: "node20",
  dts: true,
  sourcemap: false,
  clean: true,
  // glTF-Transform's sibling packages use permissive internal ranges. Keeping them external
  // lets a consumer's unrelated CLI resolve `functions` against a different `core` instance
  // than the document created here, so bundle this graph as one private runtime unit.
  noExternal: ["@gltf-transform/core", "@gltf-transform/extensions", "@gltf-transform/functions"],
  // The transforms used here never call glTF-Transform's optional Sharp image helper. Replace
  // that module while bundling so an unused CommonJS native adapter cannot leak into our ESM
  // artifact.
  esbuildOptions(options) {
    options.alias = { "ndarray-pixels": "./src/shims/gltf-transform-image.ts" };
  },
  splitting: false,
  treeshake: true,
});
