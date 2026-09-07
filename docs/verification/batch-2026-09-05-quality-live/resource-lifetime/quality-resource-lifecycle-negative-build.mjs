import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../../../../packages/create-threenative/node_modules/esbuild/lib/main.js";

const artifactDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(artifactDir, "../../../..");
const probe = resolve(artifactDir, "quality-resource-lifecycle-probe.mjs");
const output = resolve(repoRoot, "artifacts/batch-2026-09-05/quality-resource-lifecycle-probe.js");
const postprocessing = resolve(
  repoRoot,
  "packages/create-threenative/templates/starter/src/render/postprocessing.ts",
);
const token = "disposeGraph?.();";
let transformReport;

await build({
  entryPoints: [probe],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: output,
  plugins: [
    {
      name: "quality-negative-disposal-control",
      setup(pluginBuild) {
        pluginBuild.onLoad({ filter: /[/\\]postprocessing\.ts$/ }, async (args) => {
          if (resolve(args.path) !== postprocessing) return undefined;
          const source = await readFile(args.path, "utf8");
          const first = source.indexOf(token);
          const applyStart = source.indexOf("function apply(): void");
          if (first < applyStart || applyStart < 0)
            throw new Error("negative control did not find apply() disposal anchor");
          const occurrencesBefore = source.split(token).length - 1;
          const transformed = source.slice(0, first) + source.slice(first + token.length);
          const occurrencesAfter = transformed.split(token).length - 1;
          if (occurrencesAfter !== occurrencesBefore - 1 || !transformed.includes(token))
            throw new Error(
              "negative control removed the wrong disposal or removed final disposal",
            );
          transformReport = {
            path: args.path,
            removedOffset: first,
            occurrencesBefore,
            occurrencesAfter,
            removedSourceAnchor: source.slice(Math.max(0, first - 96), first + token.length + 96),
          };
          return { contents: transformed, loader: "ts", resolveDir: dirname(args.path) };
        });
      },
    },
  ],
});

console.log(`NEGATIVE_TRANSFORM:${JSON.stringify(transformReport)}`);
