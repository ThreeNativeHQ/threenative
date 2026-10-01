import { defineConfig } from "tsup";

// `three` stays external so the baked geometry belongs to the consumer's installed Three.js
// instance (the subpath is a peer dependency), never a second copy bundled into this addon.
export default defineConfig({
  entry: ["src/index.ts", "src/three.ts"],
  format: ["esm"],
  target: "node20",
  dts: true,
  sourcemap: false,
  clean: true,
  external: ["three"],
  splitting: false,
  treeshake: true,
});
