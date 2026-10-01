// Regenerates packages/assets/__tests__/fixtures/foliage-conifer.glb.
//   cd examples/integrations/vegetation && npm install --ignore-scripts && npm run build
//   node packages/assets/__tests__/fixtures/foliage-conifer.mjs
// The geometry is the engine's own procedural vegetation exporter. The leaf material is then
// re-authored as the shape a real tree pack ships — `BLEND` with the alpha in the base-colour
// texture, not the exporter's placeholder `MASK` — because that is the case PRD-458 §4 is about.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { PNG } from "pngjs";
import { MeshStandardMaterial } from "three";
import { treeToGlb } from "../../../../examples/integrations/vegetation/dist/export.js";
import { generateTree } from "../../../../examples/integrations/vegetation/dist/tree.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SIZE = 64;

/** A needle card: opaque along the middle, transparent at the edges, so a silhouette is visible. */
function needleAlpha() {
  const png = new PNG({ width: SIZE, height: SIZE });
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const edge = Math.min(x, SIZE - 1 - x, y, SIZE - 1 - y) / ((SIZE - 1) / 6);
      const i = (SIZE * y + x) * 4;
      png.data[i] = 96;
      png.data[i + 1] = 128;
      png.data[i + 2] = 64;
      png.data[i + 3] = Math.round(Math.max(0, Math.min(1, edge)) * 255);
    }
  }
  return PNG.sync.write(png);
}

const trunk = new MeshStandardMaterial();
const leaf = new MeshStandardMaterial();
const variant = generateTree({
  configure: (options) => {
    options.branch.levels = 2;
    options.leaves.count = 3;
  },
  leafMaterial: leaf,
  maxVertices: 40_000,
  seed: 42,
  trunkMaterial: trunk,
});

try {
  const source = await new NodeIO().readBinary(await treeToGlb(variant));
  const needles = source
    .getRoot()
    .listMaterials()
    .find((material) => material.getName() === "leaf");
  if (needles === undefined) throw new Error("The exported tree has no leaf material.");
  const texture = source
    .createTexture("needle-alpha")
    .setImage(needleAlpha())
    .setMimeType("image/png");
  needles.setBaseColorTexture(texture).setAlphaMode("BLEND").setDoubleSided(true);
  const out = path.join(here, "foliage-conifer.glb");
  const glb = await new NodeIO().writeBinary(source);
  await writeFile(out, glb);
  console.log(`${out} bytes=${glb.byteLength} vertices=${variant.vertices}`);
} finally {
  variant.dispose();
  trunk.dispose();
  leaf.dispose();
}
