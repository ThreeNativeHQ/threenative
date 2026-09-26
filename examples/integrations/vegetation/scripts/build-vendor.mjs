import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// The published 1.1.0 bundle eagerly loads browser textures. The pinned source
// accepts caller-provided textures and can be used by an offline Node author.
const source = new URL("../node_modules/ez-tree-source/", import.meta.url);
const output = new URL("../dist/vendor/", import.meta.url);
await mkdir(output, { recursive: true });
await build({
  entryPoints: [fileURLToPath(new URL("src/lib/index.js", source))],
  outfile: fileURLToPath(new URL("ez-tree.mjs", output)),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "es2022",
  external: ["three"],
  legalComments: "inline",
});
await copyFile(new URL("LICENSE", source), new URL("EZ-TREE-LICENSE", output));
await copyFile(
  new URL("../src/vendor/ez-tree.d.mts", import.meta.url),
  new URL("ez-tree.d.mts", output),
);
