import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/playtest.ts",
    "src/hot.ts",
    "src/react.ts",
    "src/ui-layer.ts",
    "src/world.ts",
    "src/net.ts",
    "src/webgpu.ts",
  ],
  // React and the reconciler are optional peers: the game supplies them, and `dist/index.js` must
  // never pull them in, so core stays consumable from React Three Fiber and a game that mounts no
  // React overlay pays nothing.
  external: ["react", "react-reconciler", "react-reconciler/constants.js"],
  format: ["esm"],
  target: "es2022",
  dts: {
    // `src/webgpu.ts` is the only entry whose public surface is raw WebGPU, and no lib ships those
    // globals. The reference has to survive into the emitted declaration or every consumer of the
    // seam sees `Cannot find name 'GPUTextureFormat'`; `@webgpu/types` is a runtime dependency so
    // the directive always resolves.
    banner: '/// <reference types="@webgpu/types" />',
  },
  sourcemap: false,
  clean: true,
  splitting: false,
  treeshake: true,
});
