import { defineConfig } from "tsup";

export default defineConfig([
  {
    // Some CLI inspection dependencies are CJS and need a real require inside this ESM bundle.
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
    // The asset package and codec packages stay external: emscripten loaders resolve their
    // .wasm sidecars and Node globals against their own module url. Inlining rewrites that
    // context to this ESM CLI bundle and breaks packed-project asset compilation.
    external: [
      "@threenative/assets",
      "@gltf-transform/core",
      "@gltf-transform/extensions",
      "@gltf-transform/functions",
      "draco3dgltf",
      "ktx-parse",
      "ktx2-encoder",
      "meshoptimizer",
    ],
  },
  // PRD-540: the browser binding `createWebEnginePlugin` puts in a web build under
  // `engine: "native"`. It runs in the page, so it carries no Node banner and no types.
  {
    entry: {
      "web-engine-runtime": "../three-native/src/browser-entry.ts",
      "web-engine-mesh-bvh": "../three-native/src/addons/mesh-bvh.ts",
    },
    format: ["esm"],
    platform: "browser",
    target: "es2022",
    dts: false,
    sourcemap: false,
    clean: false,
    splitting: false,
    treeshake: true,
  },
]);
