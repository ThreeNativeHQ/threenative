import { defineConfig } from "tsup";

export default defineConfig({
  // `bridge` is a second entry rather than a re-export: `@threenative/assets` imports it from the
  // asset pass and must not pull the stdio server's argv handling into a build step.
  entry: ["src/index.ts", "src/bridge.ts"],
  format: ["esm"],
  target: "es2022",
  banner: { js: "#!/usr/bin/env node" },
  dts: true,
  sourcemap: false,
  clean: true,
  splitting: false,
  treeshake: true,
});
