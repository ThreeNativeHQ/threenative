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

/**
 * How tall one of R3's characters stands, in metres — a real fox. The Khronos Fox is authored in
 * centimetres (its bind-pose bounding box is ~79 units tall), and an importer takes those units
 * literally, so an unscaled character is a 79 m statue that fills the camera and turns the rung
 * into a measurement of overdraw rather than of skinning. Both engines therefore scale the
 * character by this rule instead of by an import setting neither of them can be asked to change.
 */
export const LADDER_FOX_HEIGHT = 0.5;
/** How far a measured height may sit from `LADDER_FOX_HEIGHT`, and from the other engine's, before
 *  the run is a failed run: a fox that is not a fox is not the scene the ladder is measuring. */
export const LADDER_FOX_TOLERANCE = 0.05;

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
export function pointLightPosition(
  index: number,
  frameIndex: number,
  extent: number,
): IPointPlacement {
  const angle = frameIndex * 0.01 + (index / LADDER_POINT_LIGHTS) * Math.PI * 2;
  return {
    x: Math.cos(angle) * extent * 0.3,
    y: 6 + Math.sin(angle * 1.7) * 2,
    z: Math.sin(angle) * extent * 0.3,
  };
}

/**
 * The characters stand in a 10x5 block on the ground among the cubes: inside the sun's frustum
 * (so they are shadow casters as well as skinned meshes) and inside the camera's orbit, which is
 * what makes the skinning cost a submitted cost rather than a culled one. The block's spacing is
 * the cube spacing, so a fox stands in a gap between lattice cells rather than inside one, and the
 * y is the ground plane a `LADDER_FOX_HEIGHT` character stands on.
 */
export function characterPlacement(index: number): IPointPlacement {
  const side = 10;
  return {
    x: ((index % side) - (side - 1) / 2) * 2.5,
    y: 0,
    z: (Math.floor(index / side) - 2) * 2.5,
  };
}

/** Clip time each character starts at, so 50 copies of one clip are 50 different poses. */
export function characterStagger(index: number, clipSeconds: number): number {
  return (index / LADDER_CHARACTERS) * clipSeconds;
}

/**
 * The factor that turns a character of `rawHeight` imported units into a `LADDER_FOX_HEIGHT`
 * character. Both arms measure their own import's bind-pose bounding box and call this, so a
 * difference in how each engine imported the same bytes shows up as a difference in what they then
 * scale to rather than as two different-sized foxes in a comparison.
 */
export function foxScale(rawHeight: number): number {
  if (!Number.isFinite(rawHeight) || rawHeight <= 0)
    throw new Error(`TN_BENCH_FOX_RAW_HEIGHT:${String(rawHeight)}`);
  return LADDER_FOX_HEIGHT / rawHeight;
}

/**
 * What one arm measured about R3's characters, recorded on the rung so the two engines' foxes are
 * compared as sizes and not only as counts. `heightM` is the character root's world bounding-box
 * height at bind pose; `screenFraction` is that box's projected height as a fraction of the
 * viewport height, which is the only part of this either engine's camera can make larger.
 */
export interface IFoxMeasurement {
  readonly heightM: number;
  readonly screenFraction: number;
}

/**
 * Why a rung's recorded fox is not the fox the ladder specifies, or null when it is. Fails closed:
 * a missing, non-finite, degenerate or out-of-tolerance measurement is a reason, never a pass.
 */
export function foxMeasurementReason(measurement: IFoxMeasurement | undefined): string | null {
  if (measurement === undefined) return "no character measurement recorded";
  const { heightM, screenFraction } = measurement;
  if (!Number.isFinite(heightM) || !Number.isFinite(screenFraction))
    return `non-finite measurement ${String(heightM)} m / ${String(screenFraction)}`;
  if (heightM <= 0) return `character bounding box has no height (${heightM} m)`;
  if (screenFraction <= 0) return `character covers none of the frame (${screenFraction})`;
  const deviation = Math.abs(heightM - LADDER_FOX_HEIGHT) / LADDER_FOX_HEIGHT;
  if (deviation > LADDER_FOX_TOLERANCE)
    return `character is ${heightM.toFixed(4)} m tall, ${(deviation * 100).toFixed(1)}% off the ${LADDER_FOX_HEIGHT} m of a real fox`;
  return null;
}

/** The cross-engine half of the same rule: two foxes of the same ladder must be the same fox. */
export function foxParityReason(
  left: IFoxMeasurement | undefined,
  right: IFoxMeasurement | undefined,
): string | null {
  if (left === undefined || right === undefined)
    return "one engine recorded no character measurement";
  const difference = Math.abs(left.heightM - right.heightM) / LADDER_FOX_HEIGHT;
  if (difference > LADDER_FOX_TOLERANCE)
    return `the two engines drew foxes ${(difference * 100).toFixed(1)}% apart in height (${left.heightM.toFixed(4)} m vs ${right.heightM.toFixed(4)} m)`;
  return null;
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
export function expectedLadderCounts(rung: RealisticRung, objectCount: number): ILadderCounts {
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

/** The read-back keys, read off the stats the same way, so the gate reads exactly these four. */
export const FRAME_STAT_KEYS = Object.keys({
  distinctColors: 0,
  luminanceStdDev: 0,
  maxLuminance: 0,
  sampledPixels: 0,
} satisfies IFrameStats) as (keyof IFrameStats)[];

/** One number per asserted count, so the error names the count that did not match. */
export function ladderCountDiff(expected: ILadderCounts, actual: ILadderCounts): string | null {
  for (const key of Object.keys(expected) as (keyof ILadderCounts)[]) {
    if (expected[key] !== actual[key]) return `${key}:${actual[key]}!=${expected[key]}`;
  }
  return null;
}

/**
 * What one read-back frame said about itself: the same observations `assertCaptureNotBlank` reads
 * off a PNG in `packages/playtest/src/capture.ts`, minus the ones that need a threshold. Both arms
 * read pixels back from a GPU surface rather than from a PNG, so this is what each of them records
 * and `blankFrameReason` is what decides whether it passes — the arms hold no limit of their own,
 * and a rung that drew nothing is a failed run rather than a fast one.
 */
export interface IFrameStats {
  readonly distinctColors: number;
  readonly luminanceStdDev: number;
  readonly maxLuminance: number;
  readonly sampledPixels: number;
}

/**
 * Every 8th pixel on each axis. A 1920x1080 read-back is 8 MB and a per-pixel GDScript walk of it
 * is seconds of engine time; a 32k-pixel sample decides "is anything drawn" and costs nothing next
 * to the frame it follows. The stride is a named constant because a rung that sampled one pixel
 * would be the same rung with a much smaller sample.
 */
export const LADDER_SAMPLE_STRIDE = 8;

/**
 * `inspectFrame`'s arithmetic over an RGBA byte array, sampled every `LADDER_SAMPLE_STRIDE` pixels
 * on each axis, with the luminance weights it already uses. Every field is an observation and none
 * needs a threshold, so both arms compute this without holding a limit of their own and
 * `blankFrameReason` is the only place that decides what passes.
 */
export function frameStats(
  pixels: ArrayLike<number>,
  width: number,
  height: number,
  stride = LADDER_SAMPLE_STRIDE,
): IFrameStats {
  const colors = new Set<number>();
  let luminanceTotal = 0;
  let luminanceSquaredTotal = 0;
  let maxLuminance = 0;
  let sampledPixels = 0;
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const offset = (y * width + x) * 4;
      const red = pixels[offset] ?? 0;
      const green = pixels[offset + 1] ?? 0;
      const blue = pixels[offset + 2] ?? 0;
      const alpha = pixels[offset + 3] ?? 0;
      // The distinct-colour count is over every sample including fully transparent ones, as
      // `inspectFrame` does, so a frame with no alpha is not read as a single colour.
      colors.add(((red << 24) | (green << 16) | (blue << 8) | alpha) >>> 0);
      if (alpha === 0) continue;
      const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
      sampledPixels += 1;
      maxLuminance = Math.max(maxLuminance, luminance);
      luminanceTotal += luminance;
      luminanceSquaredTotal += luminance * luminance;
    }
  }
  const mean = sampledPixels === 0 ? 0 : luminanceTotal / sampledPixels;
  const variance = sampledPixels === 0 ? 0 : luminanceSquaredTotal / sampledPixels - mean * mean;
  return {
    distinctColors: colors.size,
    luminanceStdDev: Math.sqrt(Math.max(0, variance)),
    maxLuminance,
    sampledPixels,
  };
}

/**
 * The two failures `assertCaptureNotBlank` raises first, with its limits, over `frameStats`' output
 * — so a ladder rung is blank exactly when a playtest screenshot of the same frame would be. It
 * lives beside the guard rather than in this file because the limits are playtest's and this module
 * is served to the plain-`three` control, which carries no package code. The bright-pixel term of
 * the PNG guard is not restated: it exists to catch a mostly-empty frame with a logo on it, and a
 * uniform fill of any colour — black, white or grey — already fails on distinct colours.
 */
