#!/usr/bin/env node
// Offline authoring export. Run after `npm run build`; it imports ../dist, never a browser.
//   node scripts/export-variants.mjs --out <existing dir> --seeds 11,23 [--config <module.mjs>]
// The optional config module default-exports (options, seed) => void and replaces `configure`.
import { stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { MeshStandardMaterial } from "three";
import { treeToGlb } from "../dist/export.js";
import { generateTree } from "../dist/tree.js";
const BUDGET = 2_000_000;
const configure = (options) => {
  options.branch.levels = 1;
  options.branch.children[0] = 2;
  options.leaves.count = 2;
};
function parse(argv) {
  const parsed = { out: "", seeds: [], config: "" };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`${flag} needs a value.`);
    if (flag === "--out") parsed.out = value;
    else if (flag === "--seeds")
      parsed.seeds = value.split(",").map((seed) => {
        const number = Number(seed.trim());
        if (!Number.isInteger(number) || number < 0 || number > 0xffffffff)
          throw new Error(`Seed ${seed} is not a uint32.`);
        return number;
      });
    else if (flag === "--config") parsed.config = value;
    else throw new Error(`Unknown flag ${flag}; expected --out, --seeds or --config.`);
  }
  if (!parsed.out) throw new Error("--out is required.");
  if (parsed.seeds.length === 0) throw new Error("--seeds needs at least one uint32 seed.");
  return parsed;
}
const options = parse(process.argv.slice(2));
const out = resolve(options.out);
if (!(await stat(out).catch(() => null))?.isDirectory())
  throw new Error(`--out must be an existing directory; refusing to create ${out}.`);
let user = null;
if (options.config) {
  const module = await import(pathToFileURL(resolve(options.config)).href);
  if (typeof module.default !== "function")
    throw new Error(`${options.config} must default-export (options, seed) => void.`);
  user = module.default;
}
const trunk = new MeshStandardMaterial();
const leaf = new MeshStandardMaterial();
try {
  for (const seed of options.seeds) {
    const variant = generateTree({
      seed,
      configure: user ? (options) => user(options, seed) : configure,
      trunkMaterial: trunk,
      leafMaterial: leaf,
      maxVertices: BUDGET,
    });
    try {
      const glb = await treeToGlb(variant);
      const file = resolve(out, `tree-${seed}.glb`);
      await writeFile(file, glb);
      console.log(`${file} vertices=${variant.vertices} bytes=${glb.byteLength}`);
    } finally {
      variant.dispose();
    }
  }
} finally {
  trunk.dispose();
  leaf.dispose();
}
