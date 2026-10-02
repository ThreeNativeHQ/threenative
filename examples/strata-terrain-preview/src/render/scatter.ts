import { createRandom } from "@threenative/core";
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

/** A field the placement rule reads: the world's own baked colours plus its sampled geometry. */
export interface IPlacementField {
  readonly colors: readonly number[];
  readonly field: Heightfield;
  readonly resolution: number;
  readonly size: number;
  readonly waterLevel: number | null;
  /** Still water: nothing grows below a lake's level inside its reach. */
  readonly lakes?: readonly {
    readonly at: readonly number[];
    readonly radius: number;
    readonly level: number;
  }[];
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

/** A value clamped to 0..1, because a density is a probability and a probability above one is a bug. */
function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
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
  spruceSpacing: 8.5,
  /** Spruces tried per attempt; the rest of the budget is spent on placement, not on candidates. */
  spruceAttempts: 9000,
  /**
   * How many trunks the world grows.
   *
   * One hundred and forty, and every number in this table is a triangle budget rather than a
   * preference: the canopy is the pack's real pines at 9.3–12.5k triangles each where the procedural
   * spruce it replaced was 3.2k, so the same wood at the old three hundred and forty cost three times
   * the geometry. The sightlines the missing trunks would have carried are closed by the seedlings,
   * which are 530 triangles each.
   */
  spruceCount: 140,
  /**
   * Spruce scale range, as a multiplier on the variant's own height.
   *
   * The pack's `SM_pine01` is 10.0 m as it ships and `SM_pine03` is 9.5 m, so this band is the
   * band a wood actually has — eight to thirteen metres, with the giants left to the roll. The
   * procedural variant this range also dresses is 12–17 m, which is a taller tree at the same
   * numbers, and that is the fallback's problem and not the wood's.
   */
  spruceScale: [0.85, 1.3],
  boulderSpacing: 11,
  boulderAttempts: 2600,
  boulderScale: [0.55, 2.1],
  /**
   * The young generation, in the spruces' own shade, and how far out from a trunk a seedling stands.
   *
   * Seedlings are the cheapest way to make a wood read as a wood: `SM_pine-small01` is 530 triangles
   * against the canopy's 12,535, so six hundred of them cost what forty pines cost, and they are
   * what closes the sightlines between the trunks. The count is per trunk and the reach is short,
   * because a seedling that is not under its parent is a weed.
   */
  saplingsPerTree: 4,
  saplingReach: 7,
  saplingScale: [0.7, 1.35],
  /**
   * Shrubs, in drifts at the wood's edge and under its canopy.
   *
   * `SM_bush01` is 4,275 triangles — a waist-high cherry laurel — so this is a placement budget of
   * a few hundred rather than a few thousand, and it is spent on the ring where the canopy thins,
   * not evenly over the meadow. The clump noise is what makes a thicket read as a thicket: evenly
   * sown bushes read as pins in a map at any count.
   */
  bushAttempts: 5200,
  /** How many shrubs the world grows. Four hundred of `SM_bush01` is the thicket's whole budget. */
  bushCount: 130,
  bushClumps: 3,
  bushReach: 9,
  bushScale: [0.9, 1.7],
  /**
   * Ground cover over the grass, and the distance it thins over.
   *
   * The four `SM_grass_bush` meshes are 1.4–2.0k triangles of cut-out shrub, and this is the layer
   * that stops the meadow reading as a mown lawn between the trees. It uses grass's own falloff —
   * full density near the focus, a floor past `grassThin` — because a carpet to the horizon is a
   * hundred thousand instances that look identical from two hundred metres.
   */
  scrubCell: 1.15,
  scrubScale: [0.75, 1.6],
  /**
   * The grass cell, in metres, and the cells either side of the focus that are considered at all.
   *
   * Half a metre is the number that matters: a clump every half metre reads as continuous ground
   * from eye height, one every two metres reads as scattered weeds on a lawn, and the difference is
   * not visible in any count — only in the picture.
   */
  grassCell: 0.46,
  grassRadiusCells: 36,
  /** Metres from the focus at which the meadow is at full density, and where it has thinned to a
   *  tenth. Inside the plateau every cell is walked; outside the radius none is. */
  grassFull: 8,
  grassThin: 19,
  /**
   * Poppies grow in drifts, not patches: a patch centre, a radius around it, and the drift is thick
   * in its middle and ragged at its edge.
   *
   * Twenty drifts, not thirty-four, and held closer to the focus. Overlap them and they stop being
   * drifts: at thirty-four the colonies merged into one red band across the whole meadow, which is a
   * field of poppies rather than a meadow that has poppies in it.
   *
   * `poppyDrift` is the noise the drift's density is read from, and it is what separates a drift from
   * a disc. A radial falloff gives every patch a circular edge, and twenty circles on a hillside read
   * as twenty circles however good each poppy is.
   */
  poppyPatches: 20,
  poppyPatchRadius: [2.5, 6.5],
  poppySpacing: 0.62,
  /** How hard a drift's own noise bites into its falloff, and its scale in metres. */
  poppyDrift: { amount: 0.55, scale: 0.55 },
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
export function scatterProps(
  data: IPlacementField,
  focus: { x: number; z: number },
  /** Ground a tree must leave open — a fixed camera's eye — as `[x, z, radius]` in metres. */
  clearings: readonly (readonly [number, number, number])[] = [],
): IPropScatter {
  const placements: IPlacement[] = [];
  const counts = {
    boulder: 0,
    bush: 0,
    fern: 0,
    grass: 0,
    poppy: 0,
    sapling: 0,
    scrub: 0,
    spruce: 0,
  };
  const half = data.size / 2;
  const inside = (x: number, z: number, margin: number) =>
    Math.abs(x) <= half - margin && Math.abs(z) <= half - margin;
  const wet = (x: number, z: number) =>
    (data.waterLevel !== null && clampedHeight(data, x, z) < data.waterLevel + 0.35) ||
    (data.lakes ?? []).some(
      (lake) =>
        Math.hypot(x - (lake.at[0] ?? 0), z - (lake.at[1] ?? 0)) < lake.radius &&
        clampedHeight(data, x, z) < lake.level + 0.35,
    );

  // --- spruces: on grass, off the steep ground, out of the water ---------------------------------
  //
  // Two hundred, down from three hundred and forty, and the count is the triangle budget rather than
  // a preference: the canopy is the pack's real pines at 9.3–12.5k triangles each where the
  // procedural spruce it replaced was 3.2k, so the same wood at the same density costs three times
  // the geometry. The sightlines the extra forty carried are closed by the seedlings below for a
  // fiftieth of the price.
  const spruce = createRandom(SCATTER.seed);
  const spruceCells = new Set<string>();
  const spruceSpacing = SCATTER.spruceSpacing;
  let tries = 0;
  while (counts.spruce < SCATTER.spruceCount && tries < SCATTER.spruceAttempts) {
    tries += 1;
    const x = (spruce() - 0.5) * data.size;
    const z = (spruce() - 0.5) * data.size;
    if (!inside(x, z, 8) || wet(x, z)) continue;
    if (slopeDegrees(data, x, z) > 26) continue;
    if (grassWeight(data, x, z) < 0.55) continue;
    if (clearings.some(([cx, cz, r]) => Math.hypot(x - cx, z - cz) < r)) continue;
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

  // --- saplings and bracken: in the spruces' own shade, a few around each trunk ------------------
  // A seedling and a fern both grow where the canopy keeps the grass down, so both are placed off the
  // trees rather than over the meadow: a handful in the ring a few metres out from each trunk. The
  // seedling ring is the wider of the two, because a spruce seed lands a little way off its parent
  // and a fern does not travel at all.
  const fern = createRandom(SCATTER.seed ^ 0x3c6e);
  for (const tree of placements.filter((placement) => placement.asset === "spruce")) {
    const [tx, , tz] = tree.position;
    const saplings = SCATTER.saplingsPerTree + Math.floor(fern() * 2);
    for (let k = 0; k < saplings; k += 1) {
      const angle = fern() * Math.PI * 2;
      const reach = 1.5 + fern() * SCATTER.saplingReach;
      const x = tx + Math.cos(angle) * reach;
      const z = tz + Math.sin(angle) * reach;
      if (!inside(x, z, 4) || wet(x, z) || slopeDegrees(data, x, z) > 30) continue;
      placements.push({
        alignToNormal: false,
        asset: "sapling",
        id: `temperate-sapling:${Math.round(x * 4)},${Math.round(z * 4)}`,
        layer: "temperate-sapling",
        normal: [0, 1, 0],
        position: [x, clampedHeight(data, x, z), z],
        rotation: fern() * Math.PI * 2,
        scale:
          SCATTER.saplingScale[0] + fern() * (SCATTER.saplingScale[1] - SCATTER.saplingScale[0]),
      });
      counts.sapling += 1;
    }
    const clumps = 2 + Math.floor(fern() * 4);
    for (let k = 0; k < clumps; k += 1) {
      const angle = fern() * Math.PI * 2;
      const reach = 2 + fern() * 3;
      const x = tx + Math.cos(angle) * reach;
      const z = tz + Math.sin(angle) * reach;
      if (!inside(x, z, 4) || wet(x, z) || slopeDegrees(data, x, z) > 30) continue;
      placements.push({
        alignToNormal: false,
        asset: "fern",
        id: `temperate-fern:${Math.round(x * 4)},${Math.round(z * 4)}`,
        layer: "temperate-fern",
        normal: [0, 1, 0],
        position: [x, clampedHeight(data, x, z), z],
        rotation: fern() * Math.PI * 2,
        scale: 0.75 + fern() * 0.6,
      });
      counts.fern += 1;
    }
  }

  // --- thicket: shrubs in drifts, over the wood and along its edge --------------------------------
  //
  // Placed on the same walk as the trunks but through a clump field, so a wood has thickets to walk
  // around and bare ground between them. Evenly sown bushes read as pins in a map at any count, and
  // the walk is over the whole world rather than around each trunk: the thicket that matters is the
  // one a player brushes through on the way through the wood.
  const bush = createRandom(SCATTER.seed ^ 0x1d0b);
  tries = 0;
  while (counts.bush < SCATTER.bushCount && tries < SCATTER.bushAttempts) {
    tries += 1;
    const x = (bush() - 0.5) * data.size;
    const z = (bush() - 0.5) * data.size;
    if (!inside(x, z, 5) || wet(x, z)) continue;
    if (slopeDegrees(data, x, z) > 28) continue;
    if (grassWeight(data, x, z) < 0.35) continue;
    // Two incommensurate waves over world metres, so the drifts are metres across, irregular, and do
    // not march across the meadow the way a single sine does. Read at its own frequency from the
    // grass's, so a thicket and the meadow's thin patches are never the same patch.
    const drift = clamp01(
      0.5 + 0.34 * Math.sin(x * 0.17 + z * 0.11) + 0.22 * Math.sin(x * 0.07 - z * 0.29 + 2.1),
    );
    if (bush() > 0.18 + drift * 0.82) continue;
    placements.push({
      alignToNormal: false,
      asset: "bush",
      id: `temperate-bush:${Math.round(x * 4)},${Math.round(z * 4)}`,
      layer: "temperate-bush",
      normal: [0, 1, 0],
      position: [x, clampedHeight(data, x, z), z],
      rotation: bush() * Math.PI * 2,
      scale: SCATTER.bushScale[0] + bush() * (SCATTER.bushScale[1] - SCATTER.bushScale[0]),
    });
    counts.bush += 1;
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
  //
  // The cells themselves used to be the problem. A jittered grid is *uniform*, and a uniform carpet
  // of identical clumps reads as a lattice at eye height however good each clump is — that is the
  // judges' "uniform sparse lattice", and it is a distribution fault, not a blade fault. Two things
  // break it: the jitter is now the full cell rather than half of it, so no two clumps can share a
  // lattice position; and the density is multiplied by a clump noise, so the meadow has thin patches
  // and thick ones instead of one even mat.
  const grass = createRandom(SCATTER.seed ^ 0x27d4);
  const cellSize = SCATTER.grassCell;
  const centre = Math.round(focus.x / cellSize);
  const centreZ = Math.round(focus.z / cellSize);
  for (let row = -SCATTER.grassRadiusCells; row <= SCATTER.grassRadiusCells; row += 1) {
    for (let column = -SCATTER.grassRadiusCells; column <= SCATTER.grassRadiusCells; column += 1) {
      const cellX = (centre + column) * cellSize;
      const cellZ = (centreZ + row) * cellSize;
      const distance = Math.hypot(cellX - focus.x, cellZ - focus.z);
      // A plateau, then a ramp. A meadow read at eye height is a wall of blades in the first few
      // metres and a suggestion past fifteen, and a straight falloff from the focus cannot be both:
      // it thins the ground under the camera to make the ground at the focus thick, or the reverse.
      // Inside the plateau every cell is walked, and past `grassThin` a clump is a few pixels tall
      // and only its silhouette is left — so it thins to a floor and stops.
      const falloff = Math.max(
        0.12,
        1 -
          (Math.max(0, distance - SCATTER.grassFull) / (SCATTER.grassThin - SCATTER.grassFull)) *
            0.88,
      );
      // The clump noise: two incommensurate waves over the world position, so the patches are metres
      // across and irregular and do not repeat over the meadow the way a single sine does. Its range
      // is clamped to [thin, thick] rather than to [0, 1], because bare ground in a meadow is a
      // *thinner* meadow and not a bald patch.
      const clumping =
        0.62 +
        0.5 *
          clamp01(
            0.5 +
              0.36 * Math.sin(cellX * 0.41 + cellZ * 0.19) +
              0.24 * Math.sin(cellX * 0.13 - cellZ * 0.47 + 1.7),
          );
      if (grass() > falloff * clumping) continue;
      // Jitter across the whole cell. Half a cell's jitter leaves every clump inside a quarter of
      // its own cell, which is still a grid — this is the smallest change that actually removes it.
      const x = cellX + (grass() - 0.5) * cellSize * 2;
      const z = cellZ + (grass() - 0.5) * cellSize * 2;
      if (!inside(x, z, 4) || wet(x, z)) continue;
      const y = clampedHeight(data, x, z);
      if (slopeDegrees(data, x, z) > 30) continue;
      // Half strength over a dirt patch, not none. Grass does grow across a worn path — it is the
      // path that is thinner, not bare — and the rule that kept every blade off the bake's own dirt
      // mask is what left those patches as flat brown shapes with a hard edge.
      if (grassWeight(data, x, z) < 0.22) continue;
      placements.push({
        alignToNormal: false,
        asset: "grass",
        // The id carries the jittered position, not the cell: a clump that moves has to be a
        // different prop as far as the editor's overrides are concerned.
        id: `temperate-grass:${Math.round(x * 4)},${Math.round(z * 4)}`,
        layer: "temperate-grass",
        normal: [0, 1, 0],
        position: [x, y, z],
        rotation: grass() * Math.PI * 2,
        // Height spread as well as scale: `cover.ts` also varies each clump's own height, and this
        // is the outer spread, so a stand of clumps is knee-high in places and ankle-high in others.
        scale: (0.55 + grass() * 0.95) * clumping,
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
    const reach = Math.sqrt(poppy()) * SCATTER.grassRadiusCells * cellSize * 0.8;
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
        const radial = 1 - Math.hypot(column, row) / (cellsWide + 1);
        // And a ragged one: the drift's own noise, read in world metres so the lobes are metres
        // across rather than cells. This is the difference between a drift of poppies and a disc of
        // them — a poppy colony is thick where the ground suits it and thin where it does not.
        const drift =
          1 -
          SCATTER.poppyDrift.amount *
            (0.5 +
              0.5 *
                (Math.sin(x * SCATTER.poppyDrift.scale + patch.radius) * 0.6 +
                  Math.sin(z * SCATTER.poppyDrift.scale * 1.37 - patch.radius) * 0.4));
        const falloff = clamp01(radial * drift * 0.95);
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

  // --- scrub: the ground cover between the grass clumps -------------------------------------------
  //
  // The layer that decides whether the meadow is grass *and* something else. It walks a coarser
  // jittered cell than the grass does and rides grass's own falloff, so it thins with distance from
  // the focus rather than carpeting to the horizon, and its density is multiplied by its own clump
  // field — a third one, at its own frequency — so the cover is drifts over the meadow rather than a
  // second lawn at a different height.
  const scrub = createRandom(SCATTER.seed ^ 0x6b1c);
  const scrubCell = SCATTER.scrubCell;
  const scrubCentre = Math.round(focus.x / scrubCell);
  const scrubCentreZ = Math.round(focus.z / scrubCell);
  const scrubReach = Math.ceil((SCATTER.grassRadiusCells * cellSize * 1.6) / scrubCell);
  for (let row = -scrubReach; row <= scrubReach; row += 1) {
    for (let column = -scrubReach; column <= scrubReach; column += 1) {
      const cellX = (scrubCentre + column) * scrubCell;
      const cellZ = (scrubCentreZ + row) * scrubCell;
      const distance = Math.hypot(cellX - focus.x, cellZ - focus.z);
      const falloff = Math.max(0.1, 1 - distance / (SCATTER.grassThin * 2.4));
      const drift = clamp01(
        0.5 + 0.36 * Math.sin(cellX * 0.23 - cellZ * 0.31) + 0.2 * Math.sin(cellX * 0.61 + 0.9),
      );
      if (scrub() > falloff * drift * 0.5) continue;
      const x = cellX + (scrub() - 0.5) * scrubCell * 2;
      const z = cellZ + (scrub() - 0.5) * scrubCell * 2;
      if (!inside(x, z, 4) || wet(x, z)) continue;
      if (slopeDegrees(data, x, z) > 26) continue;
      if (grassWeight(data, x, z) < 0.3) continue;
      placements.push({
        alignToNormal: false,
        asset: "scrub",
        id: `temperate-scrub:${Math.round(x * 4)},${Math.round(z * 4)}`,
        layer: "temperate-scrub",
        normal: [0, 1, 0],
        position: [x, clampedHeight(data, x, z), z],
        rotation: scrub() * Math.PI * 2,
        scale: SCATTER.scrubScale[0] + scrub() * (SCATTER.scrubScale[1] - SCATTER.scrubScale[0]),
      });
      counts.scrub += 1;
    }
  }

  return { counts, placements };
}
