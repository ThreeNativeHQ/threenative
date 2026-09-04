import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { type Document, NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import { resolveBlender } from "../src/detect.js";
import { RECIPES, findRecipe, recipeNames, recipeSource, runRecipe } from "../src/recipes.js";

/**
 * Each shipped recipe, executed against a real Blender with a numeric assertion. A recipe that is
 * only listed is a recipe nobody has run.
 */

const blender = resolveBlender();
if (!blender.available) {
  process.stderr.write(
    `TN_BLENDER_TESTS_SKIPPED: ${blender.detail} Install Blender to run packages/blender-mcp/__tests__/recipes.spec.ts.\n`,
  );
}
const withBlender = blender.available ? describe : describe.skip;

const fixtures = path.resolve("packages/assets/__tests__/fixtures/blender");
const character = path.join(fixtures, "character.fbx");
const prop = path.join(fixtures, "flag_A_blue.fbx");

/** A cube with positions and faces and no `vt` line at all, so it arrives with no UV layer. */
const UNWRAPPED_OBJ = `o Cube
v -1 -1 -1
v -1 -1 1
v -1 1 -1
v -1 1 1
v 1 -1 -1
v 1 -1 1
v 1 1 -1
v 1 1 1
f 1 3 4 2
f 5 6 8 7
f 1 2 6 5
f 3 7 8 4
f 1 5 7 3
f 2 4 8 6
`;

/**
 * Triangles and UV sets in a produced GLB, read through the reader the runtime uses.
 *
 * Phase 4's first gates asserted only the numbers `gpl/recipes/*.py` printed, and that is exactly
 * how `decimate` passed while writing the wrong file: it reported `trianglesAfter: 154` and shipped
 * 620 triangles, because Blender's glTF exporter does not apply modifiers unless told. The summary
 * was honest about what it measured and silent about what it wrote.
 *
 * `@gltf-transform/core` directly rather than `@threenative/assets`' `gltf-io`: this package's own
 * `tsc --noEmit` compiles whatever its specs import, and that module needs `draco3dgltf` types only
 * the assets package declares. Same library underneath, and nothing here is Draco-compressed.
 */
async function readGlb(file: string): Promise<Document> {
  return new NodeIO().readBinary(await readFile(file));
}

async function glbFacts(file: string): Promise<{ triangles: number; uvSets: number }> {
  const root = (await readGlb(file)).getRoot();
  const primitives = root.listMeshes().flatMap((mesh) => mesh.listPrimitives());
  return {
    triangles: primitives.reduce(
      (total, primitive) => total + (primitive.getIndices()?.getCount() ?? 0) / 3,
      0,
    ),
    uvSets: primitives.reduce(
      (total, primitive) => total + (primitive.getAttribute("TEXCOORD_0") === null ? 0 : 1),
      0,
    ),
  };
}

describe("recipe registry", () => {
  it("should ship the source of every recipe it lists", () => {
    expect(recipeNames()).toEqual(["decimate", "unwrap", "bake_ao", "retarget"]);
    for (const recipe of RECIPES) {
      const source = recipeSource(recipe);
      expect(source, recipe.name).toContain("SPDX-License-Identifier: GPL-2.0-or-later");
      // The text is the point: an agent reads a working recipe and adapts it.
      expect(source.length, recipe.name).toBeGreaterThan(400);
      // Each recipe prints its result through `_common.emit`, which carries the marker.
      expect(source, recipe.name).toContain("emit(");
    }
  });

  it("should refuse a recipe it does not ship, naming the ones it does", () => {
    expect(() => findRecipe("sculpt-a-dragon")).toThrow(/Unknown recipe.*decimate, unwrap/su);
    expect(() => findRecipe(undefined)).toThrow(/requires a string 'name'/u);
  });

  it("should refuse a run that omits a required argument", async () => {
    await expect(runRecipe("decimate", { source: character })).rejects.toThrow(
      /requires the 'out' argument/u,
    );
  });
});

withBlender("shipped recipes against a real Blender", () => {
  it("should decimate to the requested ratio", async () => {
    const root = await makeTempDir("tn-recipe-decimate-");
    try {
      const result = await runRecipe("decimate", {
        out: path.join(root, "out.glb"),
        ratio: 0.4,
        source: character,
      });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (!result.ok) return;
      const summary = result.summary as unknown as {
        achievedRatio: number;
        trianglesAfter: number;
        trianglesBefore: number;
      };
      expect(summary.trianglesBefore).toBeGreaterThan(0);
      expect(summary.trianglesAfter).toBeLessThan(summary.trianglesBefore);
      expect(Math.abs(summary.achievedRatio - 0.4)).toBeLessThanOrEqual(0.02);
      // The file, not the report. This is the assertion that would have caught the exporter
      // dropping the modifier, and the one that keeps catching it.
      const written = await glbFacts(path.join(root, "out.glb"));
      expect(written.triangles).toBe(summary.trianglesAfter);
      expect(written.triangles).toBeLessThan(summary.trianglesBefore);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 180_000);

  it("should refuse a ratio outside (0, 1]", async () => {
    const root = await makeTempDir("tn-recipe-ratio-");
    try {
      const result = await runRecipe("decimate", {
        out: path.join(root, "out.glb"),
        ratio: 0,
        source: character,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.detail).toMatch(/'ratio' must be greater than 0/u);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 180_000);

  it("should unwrap a mesh that had no UVs", async () => {
    const root = await makeTempDir("tn-recipe-unwrap-");
    try {
      const source = path.join(root, "cube.obj");
      await writeFile(source, UNWRAPPED_OBJ);
      const result = await runRecipe("unwrap", { out: path.join(root, "out.glb"), source });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (!result.ok) return;
      const summary = result.summary as unknown as {
        unwrapped: string[];
        uvLayersAfter: number;
        uvLayersBefore: number;
      };
      // The distinguishing pair: nothing before, something after, and the mesh named.
      expect(summary.uvLayersBefore).toBe(0);
      expect(summary.uvLayersAfter).toBe(1);
      expect(summary.unwrapped.length).toBe(1);
      // And the UVs are in the file a game would load, not only in the report.
      expect((await glbFacts(path.join(root, "out.glb"))).uvSets).toBeGreaterThan(0);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 180_000);

  it("should leave an already-unwrapped mesh alone unless asked", async () => {
    const root = await makeTempDir("tn-recipe-unwrap-skip-");
    try {
      const result = await runRecipe("unwrap", { out: path.join(root, "out.glb"), source: prop });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (!result.ok) return;
      const summary = result.summary as unknown as { unwrapped: string[]; uvLayersBefore: number };
      expect(summary.uvLayersBefore).toBe(1);
      expect(summary.unwrapped).toEqual([]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 180_000);

  it("should bake an occlusion texture that is not flat", async () => {
    const root = await makeTempDir("tn-recipe-ao-");
    try {
      const out = path.join(root, "ao.png");
      const result = await runRecipe("bake_ao", { out, samples: 8, size: 64, source: prop });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (!result.ok) return;
      const summary = result.summary as unknown as {
        maxLuminance: number;
        meanLuminance: number;
        minLuminance: number;
      };
      // A flat baseline would have max === min. Occlusion computed from geometry does not.
      expect(summary.maxLuminance).toBeGreaterThan(summary.minLuminance);
      expect(summary.meanLuminance).toBeGreaterThan(0);
      expect(summary.meanLuminance).toBeLessThan(1);
      expect((await readFile(out)).length).toBeGreaterThan(0);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 300_000);

  it("should retarget clips onto the destination armature", async () => {
    const root = await makeTempDir("tn-recipe-retarget-");
    try {
      const result = await runRecipe("retarget", {
        map: { neck: "spine", root: "root", spine: "neck" },
        out: path.join(root, "out.glb"),
        source: character,
        target: character,
      });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (!result.ok) return;
      const summary = result.summary as unknown as {
        clips: string[];
        destinationBones: string[];
        skippedBones: string[];
      };
      expect(summary.clips.length).toBeGreaterThanOrEqual(2);
      expect(summary.destinationBones).toEqual(expect.arrayContaining(["neck", "root", "spine"]));
      // Every track resolved to a destination bone: nothing was silently dropped.
      expect(summary.skippedBones).toEqual([]);
      // The clips are in the exported file too, not only in the report.
      const exported = (await readGlb(path.join(root, "out.glb"))).getRoot();
      expect(exported.listAnimations().length).toBeGreaterThanOrEqual(2);
      expect(exported.listSkins().length).toBeGreaterThan(0);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 300_000);

  it("should refuse a map naming a bone the destination armature does not have", async () => {
    const root = await makeTempDir("tn-recipe-retarget-bad-");
    try {
      const result = await runRecipe("retarget", {
        map: { spine: "mixamorig:Spine" },
        out: path.join(root, "out.glb"),
        source: character,
        target: character,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.detail).toMatch(/has no bone\(s\).*mixamorig:Spine/su);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 300_000);
});
