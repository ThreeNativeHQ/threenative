import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
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
    const root = await mkdtemp(path.join(tmpdir(), "tn-recipe-decimate-"));
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
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 180_000);

  it("should refuse a ratio outside (0, 1]", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "tn-recipe-ratio-"));
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
    const root = await mkdtemp(path.join(tmpdir(), "tn-recipe-unwrap-"));
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
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 180_000);

  it("should leave an already-unwrapped mesh alone unless asked", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "tn-recipe-unwrap-skip-"));
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
    const root = await mkdtemp(path.join(tmpdir(), "tn-recipe-ao-"));
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
    const root = await mkdtemp(path.join(tmpdir(), "tn-recipe-retarget-"));
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
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 300_000);

  it("should refuse a map naming a bone the destination armature does not have", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "tn-recipe-retarget-bad-"));
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
