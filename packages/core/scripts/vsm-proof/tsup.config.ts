import { defineConfig } from "tsup";
export default defineConfig({
  entry: ["scripts/vsm-proof/proof.ts"],
  format: ["esm"],
  platform: "browser",
  target: "es2022",
  outDir: "scripts/vsm-proof/dist",
  splitting: false,
  dts: false,
  clean: true,
  noExternal: [/^three/],
});
