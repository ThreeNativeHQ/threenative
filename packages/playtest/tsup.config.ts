import { defineConfig } from "tsup";

export default defineConfig({
  // One package, three dependency tiers, per DESIGN.md §9a: modularity comes from
  // subpath exports, not from more package.json files.
  //   .        zero dependencies
  //   ./three  needs three
  //   ./runner needs playwright
  entry: ["src/index.ts", "src/three/index.ts", "src/runner/index.ts", "src/runner/cli.ts"],
  format: ["esm"],
  target: "es2022",
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  external: ["three", "playwright"],
});
