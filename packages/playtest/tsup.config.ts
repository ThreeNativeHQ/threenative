import { defineConfig } from "tsup";

export default defineConfig({
  // One package, four dependency tiers: modularity comes from subpath exports, not from more
  // package.json files.
  //   .         zero dependencies
  //   ./three   needs three
  //   ./capture needs pngjs
  //   ./runner  needs playwright
  //
  // `./capture` is its own tier rather than part of `./runner` because inspecting a captured frame
  // costs one PNG decoder, and a caller that only wants to know whether a screenshot is blank should
  // not have to pull playwright to ask.
  entry: [
    "src/index.ts",
    "src/protocol.ts",
    "src/three/index.ts",
    "src/capture.ts",
    "src/runner/index.ts",
    "src/runner/cli.ts",
  ],
  format: ["esm"],
  target: "es2022",
  banner: { js: "#!/usr/bin/env node" },
  dts: true,
  sourcemap: false,
  clean: true,
  splitting: false,
  treeshake: true,
  external: ["three", "playwright", "pngjs"],
});
