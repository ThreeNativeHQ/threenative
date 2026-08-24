import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/playtest.ts", "src/hot.ts", "src/react.ts"],
  // React and the reconciler are optional peers: the game supplies them, and `dist/index.js` must
  // never pull them in, so core stays consumable from React Three Fiber and a game that mounts no
  // React overlay pays nothing.
  external: ["react", "react-reconciler", "react-reconciler/constants.js"],
  format: ["esm"],
  target: "es2022",
  dts: true,
  sourcemap: false,
  clean: true,
  splitting: false,
  treeshake: true,
});
