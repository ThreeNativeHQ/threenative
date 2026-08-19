import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "es2022",
  banner: { js: "#!/usr/bin/env node" },
  dts: true,
  sourcemap: false,
  clean: true,
  splitting: false,
  treeshake: true,
});
