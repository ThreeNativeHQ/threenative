import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clipBoneCoverage, clipTrackBindings } from "@threenative/core";
import { describe, expect, it } from "vitest";
import { parseGltfAsset } from "../src/inspect.js";
import { ENEMY_CLIPS } from "../templates/shooter/src/entities/Enemy.js";

/**
 * The shooter's soldiers, held against the engine's own clip audit.
 *
 * The rig used to be a Mixamo terrorist with retargeted rifle clips, and the template carried a
 * 2 500-line `Enemy.ts` compensating for that rig: a procedural carriage layered over the pose,
 * a weapon pose table, a leg solver for the corpse, a stride sampler and its own rate clamps.
 * Every one of those was load-bearing against clips that no longer exist, and none of them could
 * be caught by a scenario — a folded body and a clip that binds nothing look identical on screen.
 *
 * So this reads the shipped asset instead. `clipTrackBindings` names tracks that bind no bone —
 * the `<bone>.undefined` failure that silently plays the bind pose — and `clipBoneCoverage` names
 * the bones a clip leaves behind, which is how a rig ends up carrying the last walk cycle's hand
 * shape into every pose that follows.
 */
const RIG = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "template-assets",
  "assets",
  "mannequin-combat.glb",
);

/** Bones a clip that poses a whole figure cannot leave behind and still read as a figure. */
const SPINE_AND_HEAD = ["pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "Head"];

async function loadRig(): Promise<{
  readonly clips: ReadonlyMap<string, import("three").AnimationClip>;
  readonly scene: import("three").Object3D;
}> {
  const data = await readFile(RIG);
  const parsed = await parseGltfAsset(RIG, data);
  return {
    clips: new Map(parsed.animations.map((clip) => [clip.name, clip])),
    scene: parsed.scene,
  };
}

describe("shooter enemy rig", () => {
  it("names every clip the enemy plays, so a missing one is a load error not a silent gap", async () => {
    const { clips } = await loadRig();
    expect([...ENEMY_CLIPS].filter((name) => !clips.has(name))).toEqual([]);
  });

  it("binds every track of every clip the enemy plays", async () => {
    const { clips, scene } = await loadRig();
    const unbound = ENEMY_CLIPS.flatMap((name) => {
      const clip = clips.get(name);
      if (clip === undefined) throw new Error(`shooter rig has no clip named ${name}.`);
      return clipTrackBindings(scene, clip).unbound.map((track) => `${name}: ${track}`);
    });
    // An unbound track is a track whose target does not exist on the rig, so the mixer writes
    // nothing and the bone keeps whatever the previous clip left in it.
    expect(unbound).toEqual([]);
  });

  it("drives the whole spine and head on every clip the enemy plays", async () => {
    const { clips, scene } = await loadRig();
    const undriven = ENEMY_CLIPS.flatMap((name) => {
      const clip = clips.get(name);
      if (clip === undefined) throw new Error(`shooter rig has no clip named ${name}.`);
      const coverage = clipBoneCoverage(scene, clip);
      return SPINE_AND_HEAD.filter((bone) => coverage.undriven.includes(bone)).map(
        (bone) => `${name}: ${bone}`,
      );
    });
    // A dead spine is the fold at the waist: the torso holds the previous clip's pose while the
    // legs move, which no screenshot check and no scenario can tell from a real crouch.
    expect(undriven).toEqual([]);
  });
});
