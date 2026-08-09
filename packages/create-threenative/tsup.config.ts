import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/threenative.ts"],
  format: ["esm"],
  target: "node20",
  dts: true,
  sourcemap: false,
  clean: true,
  splitting: false,
  treeshake: true,
});
