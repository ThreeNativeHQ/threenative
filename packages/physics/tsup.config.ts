import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/navigation/index.ts",
    "src/proof.ts",
    "src/native/index.ts",
    "src/native/proof.ts",
  ],
  format: ["esm"],
  target: "es2022",
  dts: true,
  sourcemap: false,
  clean: true,
  splitting: false,
  treeshake: true,
});
