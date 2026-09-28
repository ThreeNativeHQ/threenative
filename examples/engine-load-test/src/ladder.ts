// PRD-464's realistic-scene ladder, stated once. Rung R1 is the cube scene on each engine's
// defaults with a sun; every rung above adds one real-game cost on top of the rung below, and both
// engines build the same thing. This file is the table `report.ts` measures a run against, so a
// rung that did not build what it claims fails the run instead of publishing a number for a scene
// it never drew. `benchmark/godot-load-test/load_test.gd` builds the same counts and is held here
// by that assertion rather than by a second copy of these numbers.

export const REALISTIC_RUNGS = ["R1", "R2", "R3", "R4", "R5"] as const;
export type RealisticRung = (typeof REALISTIC_RUNGS)[number];

/** One shadow map, the same size in both engines, and one frustum covering the whole lattice. */
export const LADDER_SHADOW_MAP_SIZE = 2048;
export const LADDER_POINT_LIGHTS = 8;
export const LADDER_CHARACTERS = 50;
export const LADDER_WIDTH = 1280;
export const LADDER_HEIGHT = 720;
export const LADDER_HEADLINE_WIDTH = 1920;
export const LADDER_HEADLINE_HEIGHT = 1080;
/** The clip the characters play, named in the Khronos Fox's own glTF as `Run`. */
export const LADDER_CLIP = "Run";

/**
 * R3's character, as pinned by `benchmark/engine-load-test/sources.lock.json`: the bytes live in the
 * git-ignored artifact tree, so a run resolves this path (or `TN_BENCH_FOX`) and refuses to start
 * unless the digest is the pinned one. Both arms read the same file.
 */
export const FOX_RELATIVE_PATH =
  "artifacts/engine-load-test/prd-449/bevy/src/assets/models/animated/Fox.glb";
export const FOX_SHA256 = "d97044e701822bac5a62696459b27d7b375aada5de8574ed4362edbba94771f7";
/**
 * Matched tonemapping and bloom. Godot's glow is three separate knobs where three's bloom is one
 * node, so the settings are matched to the same band rather than to the same numbers; the PRD asks
 * for the cost, not for the look.
 */
export const LADDER_TONEMAPPING = "ACESFilmic";
export const LADDER_BLOOM_STRENGTH = 0.5;
export const LADDER_BLOOM_RADIUS = 0.4;
export const LADDER_BLOOM_THRESHOLD = 0.9;

export interface IPointPlacement {
  x: number;
  y: number;
  z: number;
}

/**
 * The eight local lights on a fixed deterministic orbit — a pure function of the light index and
 * the frame index, never of elapsed time, so a slow arm and a fast arm frame the same scene at
 * frame 317. Ported verbatim in `load_test.gd`.
 */
export function pointLightPosition(index: number, frameIndex: number, extent: number): IPointPlacement {
  const angle = frameIndex * 0.01 + (index / LADDER_POINT_LIGHTS) * Math.PI * 2;
  return {
    x: Math.cos(angle) * extent * 0.3,
    y: 6 + Math.sin(angle * 1.7) * 2,
    z: Math.sin(angle) * extent * 0.3,
  };
}

/**
 * The characters stand in a 10x5 block above the lattice: inside the sun's frustum (so they are
 * shadow casters as well as skinned meshes) and inside the camera's orbit, which is what makes the
 * skinning cost a submitted cost rather than a culled one.
 */
export function characterPlacement(index: number): IPointPlacement {
  const side = 10;
  return {
    x: (index % side - (side - 1) / 2) * 2.4,
    y: 4.5,
    z: (Math.floor(index / side) - 2) * 2.4,
  };
}

/** Clip time each character starts at, so 50 copies of one clip are 50 different poses. */
export function characterStagger(index: number, clipSeconds: number): number {
  return (index / LADDER_CHARACTERS) * clipSeconds;
}

export interface ILadderCounts {
  readonly pointLights: number;
  readonly postPasses: number;
  readonly resolution: string;
  readonly shadowCasters: number;
  readonly skinnedMeshes: number;
  readonly tonemapping: number;
}

export function ladderRank(rung: RealisticRung): number {
  return REALISTIC_RUNGS.indexOf(rung);
}

/** The first rung whose index `rank` is at or above, so the table reads as the ladder it is. */
export function rungAtLeast(rank: number, rung: RealisticRung): boolean {
  return rank >= ladderRank(rung);
}

export function resolutionOf(rung: RealisticRung): { width: number; height: number } {
  return rung === "R5"
    ? { width: LADDER_HEADLINE_WIDTH, height: LADDER_HEADLINE_HEIGHT }
    : { width: LADDER_WIDTH, height: LADDER_HEIGHT };
}

/** What a rung must end up containing, as a function of the rung and the cube count it reused. */
export function expectedLadderCounts(
  rung: RealisticRung,
  objectCount: number,
): ILadderCounts {
  const rank = ladderRank(rung);
  return {
    pointLights: rungAtLeast(rank, "R2") ? LADDER_POINT_LIGHTS : 0,
    postPasses: rungAtLeast(rank, "R4") ? 1 : 0,
    resolution: (() => {
      const size = resolutionOf(rung);
      return `${size.width}x${size.height}`;
    })(),
    shadowCasters: objectCount + (rungAtLeast(rank, "R3") ? LADDER_CHARACTERS : 0),
    skinnedMeshes: rungAtLeast(rank, "R3") ? LADDER_CHARACTERS : 0,
    tonemapping: rungAtLeast(rank, "R4") ? 1 : 0,
  };
}

/** The asserted count keys, read off the spec so a reader can never check a different set. */
export const LADDER_COUNT_KEYS = Object.keys(
  expectedLadderCounts("R1", 0),
) as (keyof ILadderCounts)[];

/** One number per asserted count, so the error names the count that did not match. */
export function ladderCountDiff(
  expected: ILadderCounts,
  actual: ILadderCounts,
): string | null {
  for (const key of Object.keys(expected) as (keyof ILadderCounts)[]) {
    if (expected[key] !== actual[key]) return `${key}:${actual[key]}!=${expected[key]}`;
  }
  return null;
}
