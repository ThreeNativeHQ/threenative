import { defineConfig } from "tsup";

export default defineConfig({
  // The bundled @threenative/assets pulls in CJS deps (pngjs, jpeg-js) whose `require("util")`
  // needs a real require inside this ESM bundle; without the banner tsup's interop throws
  // "Dynamic require of ... is not supported" the moment the CLI loads.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);",
  },
  entry: ["src/index.ts", "src/threenative.ts"],
  format: ["esm"],
  target: "node20",
  dts: true,
  sourcemap: false,
  clean: true,
  splitting: false,
  treeshake: true,
  // Codec packages stay external: emscripten loaders resolve their .wasm sidecars against
  // their own module url, which inlining would rewrite to this bundle's directory — a
  // scaffolded project then fails its first asset compile with ENOENT. They resolve from
  // the installed @threenative/* packages instead.
  external: [
    "@gltf-transform/core",
    "@gltf-transform/extensions",
    "@gltf-transform/functions",
    "draco3dgltf",
    "ktx-parse",
    "ktx2-encoder",
    "meshoptimizer",
  ],
});
