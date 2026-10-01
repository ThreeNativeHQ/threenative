// Where the Temperate starter's props go.
//
// The rule is short and it is the rule the rubric is written against: a spruce stands on grass, a
// boulder stands on grass or rock, grass grows on grass, poppies grow in patches on grass — and
// nothing stands on sand, on the road, on a cliff, or in the sea. Every placement here is read off
// the same baked data the ground material draws from, so the meadow and its trees agree about where
// the grass is instead of disagreeing.
//
// Placement is seeded and deterministic: the same world always grows the same forest, and a camera
// can walk through it twice without the trees moving. Nothing here reads the frame clock.
import type { Heightfield } from "@threenative/core/world";
import type { IPlacement } from "@threenative/terrain";
import { createRandom } from "@threenative/core";

/** A field the placement rule reads: the world's own baked colours plus its sampled geometry. */
export interface IPlacementField {
  readonly colors: readonly number[];
  readonly field: Heightfield;
  readonly resolution: number;
  readonly size: number;
  readonly waterLevel: number | null;
}

/**
 * What the ground is where a prop wants to stand.
 *
 * `grass` is how much of that sample is meadow, in 0..1. The bake painted its own palette into the
 * vertex colours, and the same signal the ground material uses to blend its layers is the signal
 * here: green over red is grass, red over green is the road, the dirt patch and the beach.
 */
export function grassWeight(data: IPlacementField, x: number, z: number): number {
  const column = Math.round((x / data.size + 0.5) * (data.resolution - 1));
  const row = Math.round((z / data.size + 0.5) * (data.resolution - 1));
  const index =
    Math.min(data.resolution - 1, Math.max(0, row)) * data.resolution +
    Math.min(data.resolution - 1, Math.max(0, column));
  const base = index * 3;
  const r = data.colors[base];
  const g = data.colors[base + 1];
  if (r === undefined || g === undefined) return 0;
  // The bake's palette puts grass above 0 in green and the road, dirt and sand below it in red.
  const green = g - r;
  // The bake's palette is quantised, and its meadow green sits 0.06 above its red, so that is the
  // full-strength reference rather than an arbitrary one.
  if (green <= 0.02) return 0;
  return Math.min(1, green / 0.06);
}

/** The world's edge, clamped: a slope probe a metre outside the field is a probe of nothing. */
function clampedHeight(data: IPlacementField, x: number, z: number): number {
  const limit = data.size / 2 - 0.001;
  return data.field.heightAt(
    Math.min(limit, Math.max(-limit, x)),
    Math.min(limit, Math.max(-limit, z)),
  );
}

/** Slope at a sample, in degrees. A spruce will not stand on a cliff; grass will not either. */
export function slopeDegrees(data: IPlacementField, x: number, z: number): number {
  const step = data.size / (data.resolution - 1);
  const dx = clampedHeight(data, x + step, z) - clampedHeight(data, x - step, z);
  const dz = clampedHeight(data, x, z + step) - clampedHeight(data, x, z - step);
  return (Math.atan(Math.hypot(dx, dz) / (2 * step)) * 180) / Math.PI;
}

/** Every placement, for one world, from one seed. */
export interface IPropScatter {
  readonly placements: IPlacement[];
  /** How many of each prop was accepted, for the report and the playtest's own state. */
  readonly counts: Record<string, number>;
}

/** How much of each prop the Temperate starter grows, and where it will accept one. */
export const SCATTER = {
  /** Metres between two accepted spruces. A forest, not an orchard. */
  spruceSpacing: 7.5,
  /** Spruces tried per attempt; the rest of the budget is spent on placement, not on candidates. */
  spruceAttempts: 9000,
  /** Spruce scale range, as a multiplier on the variant's own height. */
  spruceScale: [0.62, 1.18],
  boulderSpacing: 11,
  boulderAttempts: 2600,
  boulderScale: [0.7, 2.6],
  /** Grass clumps per accepted cell, and the cell size, in metres. */
  grassCell: 2.6,
  /** Cells either side of the focus that are considered at all. */
  grassRadiusCells: 11,
  /** Poppies grow in patches: a patch centre, and a radius around it, in metres. */
  poppyPatches: 26,
  poppyPatchRadius: [3.5, 11],
  poppySpacing: 0.85,
  seed: 466_468,
} as const;

/**
 * The placement rule, over the baked field.
 *
 * Three loops, one per prop, each seeded from its own name so adding a fourth never moves the
 * forest. Every loop walks a jittered grid rather than random points: a grid plus a jitter is
 * evenly covered with no clustering algorithm, and it makes the spacing rule a cell comparison
 * instead of an O(n²) neighbour search over a few thousand candidates.
 */
export function scatterProps(data: IPlacementField, focus: { x: number; z: number }): IPropScatter {
  const placements: IPlacement[] = [];
  const counts = { boulder: 0, grass: 0, poppy: 0, spruce: 0 };
  const half = data.size / 2;
  const inside = (x: number, z: number, margin: number) =>
    Math.abs(x) <= half - margin && Math.abs(z) <= half - margin;
  const wet = (x: number, z: number) =>
    data.waterLevel !== null && clampedHeight(data, x, z) < data.waterLevel + 0.35;

  // --- spruces: on grass, off the steep ground, out of the water ---------------------------------
  const spruce = createRandom(SCATTER.seed);
  const spruceCells = new Set<string>();
  const spruceSpacing = SCATTER.spruceSpacing;
  let tries = 0;
  while (counts.spruce < 340 && tries < SCATTER.spruceAttempts) {
    tries += 1;
    const x = (spruce() - 0.5) * data.size;
    const z = (spruce() - 0.5) * data.size;
    if (!inside(x, z, 8) || wet(x, z)) continue;
    if (slopeDegrees(data, x, z) > 26) continue;
    if (grassWeight(data, x, z) < 0.55) continue;
    const cell = `${Math.round(x / spruceSpacing)},${Math.round(z / spruceSpacing)}`;
    if (spruceCells.has(cell)) continue;
    spruceCells.add(cell);
    const y = clampedHeight(data, x, z);
    placements.push({
      alignToNormal: false,
      asset: "spruce",
      id: `temperate-spruce:${cell}`,
      layer: "temperate-spruce",
      normal: [0, 1, 0],
      position: [x, y, z],
      rotation: spruce() * Math.PI * 2,
      scale: SCATTER.spruceScale[0] + spruce() * (SCATTER.spruceScale[1] - SCATTER.spruceScale[0]),
    });
    counts.spruce += 1;
  }

  // --- boulders: on rock and on grass, out of the water, never mid-cliff -------------------------
  const rock = createRandom(SCATTER.seed ^ 0x51ed);
  const rockCells = new Set<string>();
  tries = 0;
  while (counts.boulder < 90 && tries < SCATTER.boulderAttempts) {
    tries += 1;
    const x = (rock() - 0.5) * data.size;
    const z = (rock() - 0.5) * data.size;
    if (!inside(x, z, 6) || wet(x, z)) continue;
    const y = clampedHeight(data, x, z);
    // A boulder is the one prop that belongs on steep ground: that is where rock is exposed.
    if (slopeDegrees(data, x, z) > 46) continue;
    if (grassWeight(data, x, z) > 0.9) continue;
    const cell = `${Math.round(x / SCATTER.boulderSpacing)},${Math.round(z / SCATTER.boulderSpacing)}`;
    if (rockCells.has(cell)) continue;
    rockCells.add(cell);
    placements.push({
      alignToNormal: false,
      asset: "boulder",
      id: `temperate-boulder:${cell}`,
      layer: "temperate-boulder",
      normal: [0, 1, 0],
      position: [x, y, z],
      rotation: rock() * Math.PI * 2,
      scale: SCATTER.boulderScale[0] + rock() * (SCATTER.boulderScale[1] - SCATTER.boulderScale[0]),
    });
    counts.boulder += 1;
  }

  // --- grass: only near the focus, and thinning with distance from it ----------------------------
  //
  // One InstancedMesh for every clump in the meadow, so the count has to fall off: a uniform carpet
  // out to the horizon is a hundred thousand instances to look identical from two hundred metres.
  // Density is therefore a function of distance from the focus, and the cells beyond the radius are
  // not walked at all.
  const grass = createRandom(SCATTER.seed ^ 0x27d4);
  const cellSize = SCATTER.grassCell;
  const cells = SCATTER.grassRadiusCells * 2 + 1;
  const centre = Math.round(focus.x / cellSize);
  const centreZ = Math.round(focus.z / cellSize);
  for (let row = -SCATTER.grassRadiusCells; row <= SCATTER.grassRadiusCells; row += 1) {
    for (let column = -SCATTER.grassRadiusCells; column <= SCATTER.grassRadiusCells; column += 1) {
      const cellX = (centre + column) * cellSize;
      const cellZ = (centreZ + row) * cellSize;
      const distance = Math.hypot(cellX - focus.x, cellZ - focus.z);
      // Full density out to a third of the radius, thinning to a fifth of that at the edge.
      const density = Math.max(0.16, 1 - distance / (SCATTER.grassRadiusCells * cellSize * 1.15));
      if (grass() > density * 0.92) continue;
      const x = cellX + (grass() - 0.5) * cellSize;
      const z = cellZ + (grass() - 0.5) * cellSize;
      if (!inside(x, z, 4) || wet(x, z)) continue;
      const y = clampedHeight(data, x, z);
      if (slopeDegrees(data, x, z) > 30) continue;
      if (grassWeight(data, x, z) < 0.5) continue;
      placements.push({
        alignToNormal: false,
        asset: "grass",
        id: `temperate-grass:${centre + column}:${centreZ + row}`,
        layer: "temperate-grass",
        normal: [0, 1, 0],
        position: [x, y, z],
        rotation: grass() * Math.PI * 2,
        scale: 0.75 + grass() * 0.55,
      });
      counts.grass += 1;
    }
  }

  // --- poppies: in patches, on grass ------------------------------------------------------------
  //
  // Scattered evenly, poppies read as weeds. In patches with a hard-ish edge, they read as a colony
  // of the same plant, which is what a poppy field actually is.
  const poppy = createRandom(SCATTER.seed ^ 0x9e37);
  const patches: { x: number; z: number; radius: number }[] = [];
  for (let p = 0; p < SCATTER.poppyPatches; p += 1) {
    const angle = poppy() * Math.PI * 2;
    const reach = Math.sqrt(poppy()) * SCATTER.grassRadiusCells * cellSize * 1.1;
    patches.push({
      radius:
        SCATTER.poppyPatchRadius[0] +
        poppy() * (SCATTER.poppyPatchRadius[1] - SCATTER.poppyPatchRadius[0]),
      x: focus.x + Math.cos(angle) * reach,
      z: focus.z + Math.sin(angle) * reach,
    });
  }
  for (const patch of patches) {
    const cellsWide = Math.max(1, Math.round(patch.radius / SCATTER.poppySpacing));
    for (let row = -cellsWide; row <= cellsWide; row += 1) {
      for (let column = -cellsWide; column <= cellsWide; column += 1) {
        const x = patch.x + column * SCATTER.poppySpacing + (poppy() - 0.5) * SCATTER.poppySpacing;
        const z = patch.z + row * SCATTER.poppySpacing + (poppy() - 0.5) * SCATTER.poppySpacing;
        // A soft edge: the square falloff would give every patch a square.
        const falloff = 1 - Math.hypot(column, row) / (cellsWide + 1);
        if (poppy() > falloff) continue;
        if (!inside(x, z, 3) || wet(x, z)) continue;
        const y = clampedHeight(data, x, z);
        if (slopeDegrees(data, x, z) > 22) continue;
        if (grassWeight(data, x, z) < 0.6) continue;
        placements.push({
          alignToNormal: false,
          asset: "poppy",
          id: `temperate-poppy:${Math.round(x * 4)},${Math.round(z * 4)}`,
          layer: "temperate-poppy",
          normal: [0, 1, 0],
          position: [x, y, z],
          rotation: poppy() * Math.PI * 2,
          scale: 0.8 + poppy() * 0.5,
        });
        counts.poppy += 1;
      }
    }
  }

  return { counts, placements };
}
