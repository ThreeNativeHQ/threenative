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
import type { WorldName } from "./biomes.js";

/** A field the placement rule reads: the world's own baked colours plus its sampled geometry. */
export interface IPlacementField {
  readonly colors: readonly number[];
  readonly field: Heightfield;
  readonly resolution: number;
  readonly size: number;
  readonly waterLevel: number | null;
  readonly world?: WorldName;
  /** Still water: nothing grows below a lake's level inside its reach. */
  readonly rivers?: readonly {
    readonly points: readonly (readonly number[])[];
    readonly width: number;
  }[];
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
  // terrain.ts now blends by actual landform, not the bake's old brown palette.
  // Match its meadow/rock/alpine and beach reaches so a green surface grows real cover.
  const height = clampedHeight(data, x, z);
  if (data.world === "coastal" && data.waterLevel !== null)
    return (
      clamp01((height - data.waterLevel - 1.8) / 5.7) *
      clamp01((42 - slopeDegrees(data, x, z)) / 20)
    );
  if (data.waterLevel !== null && height < data.waterLevel + 7.5) return 0;
  const slope = slopeDegrees(data, x, z);
  if (data.world === "alpine") return clamp01((38 - slope) / 22) * clamp01((88 - height) / 40);
  if (data.world === "desert") return clamp01((24 - slope) / 20) * 0.32;
  if (data.world === "tundra")
    return clamp01((30 - slope) / 22) * clamp01((forestWeight(x * 9.8, z * 8.7) - 0.47) / 0.3);
  return clamp01((42 - slope) / 20) * clamp01((66 - height) / 28);
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

/** Stand density is world-space and seeded; broad irregular patches leave connected meadows. */
export function forestWeight(x: number, z: number): number {
  return clamp01(
    0.52 +
      0.27 * Math.sin(x * 0.035 + z * 0.018) +
      0.24 * Math.sin(z * 0.043 - x * 0.017 + 1.3) +
      0.12 * Math.sin(x * 0.071 + z * 0.061),
  );
}
export const SCATTER = {
  spruceSpacing: 4.6,
  spruceCount: 3200,
  spruceAttempts: 80000,
  grassCell: 1.2,
  grassFull: 22,
  grassThin: 62,
  seed: 466_468,
} as const;

export function scatterProps(
  data: IPlacementField,
  focus: { x: number; z: number },
  clearings: readonly (readonly [number, number, number])[] = [],
): IPropScatter {
  const temperate = data.world === undefined || data.world === "forest" || data.world === "coastal";
  const desert = data.world === "desert";
  const tundra = data.world === "tundra";
  const alpine = data.world === "alpine";
  const treeLimit = temperate ? SCATTER.spruceCount : desert ? 0 : tundra ? 55 : 600;
  const placements: IPlacement[] = [];
  const counts: Record<string, number> = Object.fromEntries(
    [
      "boulder",
      "bush",
      "fern",
      "grass",
      "poppy",
      "sapling",
      "scrub",
      "spruce",
      "riverrock",
      "scree",
      "cliff",
      "mountain",
      "volcanic",
      "reveal",
    ].map((name) => [name, 0]),
  );
  const random = createRandom(SCATTER.seed);
  const half = data.size / 2;
  const inside = (x: number, z: number) => Math.abs(x) < half - 3 && Math.abs(z) < half - 3;
  const wet = (x: number, z: number) =>
    (data.waterLevel !== null && clampedHeight(data, x, z) < data.waterLevel + 0.35) ||
    (tundra &&
      (data.rivers ?? []).some((river) =>
        river.points.some((b, index) => {
          const a = river.points[index - 1];
          if (!a) return false;
          const dx = (b[0] ?? 0) - (a[0] ?? 0);
          const dz = (b[2] ?? 0) - (a[2] ?? 0);
          const t = clamp01(
            ((x - (a[0] ?? 0)) * dx + (z - (a[2] ?? 0)) * dz) / (dx * dx + dz * dz || 1),
          );
          const distance = Math.hypot(x - (a[0] ?? 0) - t * dx, z - (a[2] ?? 0) - t * dz);
          const level = (a[1] ?? 0) + t * ((b[1] ?? 0) - (a[1] ?? 0));
          return distance < river.width * 2.5 && clampedHeight(data, x, z) < level + 0.35;
        }),
      )) ||
    (data.lakes ?? []).some(
      (lake) =>
        Math.hypot(x - (lake.at[0] ?? 0), z - (lake.at[1] ?? 0)) < lake.radius &&
        clampedHeight(data, x, z) < lake.level + 0.35,
    );
  const put = (asset: string, x: number, z: number, scale: number, suffix = "") => {
    if (!inside(x, z) || (asset !== "riverrock" && wet(x, z))) return;
    if (asset === "cliff") {
      // Stones normalize their largest dimension to 18 m. This envelope covers every yaw.
      const reach = 18 * Math.SQRT1_2 * scale;
      if (
        data.waterLevel !== null ||
        [-reach, 0, reach].some((dx) =>
          [-reach, 0, reach].some(
            (dz) =>
              grassWeight(data, x + dx, z + dz) > 0.05 || slopeDegrees(data, x + dx, z + dz) < 43,
          ),
        )
      )
        return;
    }
    if (alpine && asset === "mountain" && (Math.abs(x) > half - 48 || Math.abs(z) > half - 48))
      return;
    if (desert && ["boulder", "scree", "volcanic", "reveal"].includes(asset)) {
      const height = clampedHeight(data, x, z);
      const slope = slopeDegrees(data, x, z);
      const neighbours = [
        [-18, 0],
        [18, 0],
        [0, -18],
        [0, 18],
      ].map(([dx, dz]) => clampedHeight(data, x + (dx ?? 0), z + (dz ?? 0)));
      const foot = height < 30 && slope < 35 && Math.max(...neighbours) > height + 12;
      const rim = height > 40 && slope < 24 && Math.min(...neighbours) < height - 12;
      if (!foot && !rim) return;
    }
    const index = counts[asset] ?? 0;
    const crag = asset === "mountain" || asset === "volcanic" || asset === "reveal";
    const bedded = temperate && ["boulder", "riverrock", "scree"].includes(asset);
    const normal = crag || bedded ? data.field.normalAt(x, z) : undefined;
    if (crag && normal) {
      normal.y += 0.65;
      normal.normalize();
    }
    placements.push({
      asset,
      id: `temperate-${asset}:${index}${suffix}`,
      layer: `temperate-${asset}`,
      alignToNormal: crag || bedded || (temperate && (asset === "spruce" || asset === "sapling")),
      normal:
        (crag || bedded) && normal
          ? normal.toArray()
          : temperate && (asset === "spruce" || asset === "sapling")
            ? [Math.sin(x * 1.17 + z) * 0.045, 1, Math.cos(z * 1.31 - x) * 0.045]
            : [0, 1, 0],
      position: [x, clampedHeight(data, x, z), z],
      rotation:
        crag && normal
          ? Math.atan2(normal.x, normal.z) + (random() - 0.5) * 0.6
          : random() * Math.PI * 2,
      scale,
    });
    counts[asset] = index + 1;
  };
  const nearEye = (x: number, z: number) =>
    clearings.some(([cx, cz, radius]) => Math.hypot(x - cx, z - cz) < radius * 1.6);
  const cells = new Map<string, [number, number]>();
  const treeAsset = temperate || alpine ? "spruce" : "sapling";
  for (
    let tries = 0;
    (counts[treeAsset] ?? 0) < treeLimit && tries < SCATTER.spruceAttempts;
    tries++
  ) {
    const x = (random() - 0.5) * data.size;
    const z = (random() - 0.5) * data.size;
    if (
      !inside(x, z) ||
      wet(x, z) ||
      nearEye(x, z) ||
      slopeDegrees(data, x, z) > 32 ||
      (temperate &&
        data.waterLevel !== null &&
        clampedHeight(data, x, z) < data.waterLevel + 7.5) ||
      (data.world === "alpine" && clampedHeight(data, x, z) > 52) ||
      grassWeight(data, x, z) < (temperate ? 0.3 : 0.18) ||
      forestWeight(x, z) < (temperate ? 0.3 : 0.42)
    )
      continue;
    const cx = Math.floor(x / SCATTER.spruceSpacing);
    const cz = Math.floor(z / SCATTER.spruceSpacing);
    let crowded = false;
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const tree = cells.get(`${cx + dx},${cz + dz}`);
        if (tree && Math.hypot(tree[0] - x, tree[1] - z) < 3.4) crowded = true;
      }
    const key = `${cx},${cz}`;
    if (crowded || cells.has(key)) continue;
    cells.set(key, [x, z]);
    put(
      treeAsset,
      x,
      z,
      temperate
        ? 0.6 + 0.8 * clamp01((forestWeight(x * 0.4, z * 0.4) - 0.15) * 0.7 + random() * 0.4)
        : (tundra ? 0.25 : 0.55) + random() * 0.35,
    );
    // Regeneration at stand edges; ferns stay under established crowns.
    const edge = forestWeight(x, z) < 0.57;
    for (let i = 0; i < (tundra ? 0 : edge ? 2 : 1); i++) {
      const angle = random() * Math.PI * 2;
      const reach = 2 + random() * 4;
      const sx = x + Math.cos(angle) * reach;
      const sz = z + Math.sin(angle) * reach;
      if (!nearEye(sx, sz) && grassWeight(data, sx, sz) > 0.25)
        put("sapling", sx, sz, 0.7 + random() * 0.65);
    }
    for (let i = 0; i < (temperate ? 2 : 0); i++)
      put("fern", x + (random() - 0.5) * 7, z + (random() - 0.5) * 7, 0.7 + random() * 0.6);
  }
  // Ribs overlap along fall lines; the ground remains visible as gullies and snow shelves.
  if (alpine) {
    for (let z = -half + 48; z < half - 48; z += 24)
      for (let x = -half + 48; x < half - 48; x += 24) {
        const sx = x + (random() - 0.5) * 12;
        const sz = z + (random() - 0.5) * 12;
        if (slopeDegrees(data, sx, sz) < 32 || clampedHeight(data, sx, sz) < 48 || random() > 0.82)
          continue;
        const metres = 30 + random() * 50;
        put("mountain", sx, sz, metres / 24);
        const fall = data.field.normalAt(sx, sz);
        const length = Math.hypot(fall.x, fall.z) || 1;
        const overlapX = sx + (fall.x / length) * metres * 0.28;
        const overlapZ = sz + (fall.z / length) * metres * 0.28;
        if (
          clampedHeight(data, overlapX, overlapZ) > 42 &&
          slopeDegrees(data, overlapX, overlapZ) > 28
        )
          put("mountain", overlapX, overlapZ, Math.max(30, metres * 0.85) / 24);
        // A broad toe of small angular debris, widening downhill from each exposed wall.
        for (let k = 0; k < 28; k++) {
          const down = 16 + random() * 24;
          const across = (random() - 0.5) * down;
          const tx = sx + (fall.x * down - fall.z * across) / length;
          const tz = sz + (fall.z * down + fall.x * across) / length;
          if (slopeDegrees(data, tx, tz) < 38) put("scree", tx, tz, 0.08 + random() * 0.28);
        }
      }
  }
  if (desert) {
    for (let z = -half + 18; z < half - 18; z += 9)
      for (let x = -half + 18; x < half - 18; x += 9) {
        const sx = x + (random() - 0.5) * 7;
        const sz = z + (random() - 0.5) * 7;
        if (random() < 0.7) put("volcanic", sx, sz, 0.24 + random() * 0.48);
        if (random() < 0.5) put("reveal", sx, sz, 0.4 + random() * 0.6);
      }
  }
  // Rock clusters follow exposed slopes rather than evenly spaced lawn ornaments.
  for (let i = 0; i < (temperate ? 1500 : 2400); i++) {
    const x = (random() - 0.5) * data.size;
    const z = (random() - 0.5) * data.size;
    if (!inside(x, z) || wet(x, z)) continue;
    const slope = slopeDegrees(data, x, z);
    if (slope < (tundra ? 3 : desert ? 8 : 15) || random() > 0.38 || nearEye(x, z)) continue;
    if (slope > 43) {
      if (temperate && random() < 0.22) put("cliff", x, z, 0.65 + random() * 0.5);
      continue;
    }
    if (slope > (temperate ? 28 : 18) && random() < 0.45) put("scree", x, z, 0.7 + random() * 0.7);
    if (alpine && slope > 18 && slope < 38) {
      for (let k = 0; k < 8; k++) {
        const sx = x + (random() - 0.5) * 14;
        const sz = z + (random() - 0.5) * 14;
        if (slopeDegrees(data, sx, sz) < 42) put("scree", sx, sz, 0.12 + random() * 0.22);
      }
    }
    for (let k = 0; k < 2 + Math.floor(random() * 3); k++)
      put("boulder", x + (random() - 0.5) * 8, z + (random() - 0.5) * 8, 0.45 + random() * 0.8);
  }
  if (temperate && data.waterLevel !== null) {
    // Reuse the river stones for a broken rocky tide line, below the vegetation's beach exclusion.
    for (let i = 0; i < 2200; i++) {
      const x = (random() - 0.5) * data.size;
      const z = (random() - 0.5) * data.size;
      const above = clampedHeight(data, x, z) - data.waterLevel;
      if (above < 0.4 || above > 4.8 || slopeDegrees(data, x, z) > 38 || random() > 0.28) continue;
      put("riverrock", x, z, 0.8 + random() * 2.4);
      if (random() < 0.22) put("boulder", x + 1.2, z - 1.2, 0.3 + random() * 0.5);
    }
  }
  for (const river of data.rivers ?? []) {
    for (let i = 1; i < river.points.length; i++) {
      const a = river.points[i - 1];
      const b = river.points[i];
      if (!a || !b) continue;
      const dx = (b[0] ?? 0) - (a[0] ?? 0);
      const dz = (b[2] ?? 0) - (a[2] ?? 0);
      const length = Math.hypot(dx, dz);
      for (let at = 0; at < length; at += 2.4) {
        const side = random() < 0.5 ? -1 : 1;
        const reach = river.width * (0.42 + random() * 0.3) * side;
        put(
          "riverrock",
          (a[0] ?? 0) + (dx * at) / length - (dz / length) * reach,
          (a[2] ?? 0) + (dz * at) / length + (dx / length) * reach,
          0.5 + random() * 1.2,
        );
      }
    }
  }
  const cover = (x: number, z: number, density: number) => {
    if (
      !inside(x, z) ||
      wet(x, z) ||
      slopeDegrees(data, x, z) > 34 ||
      grassWeight(data, x, z) < 0.22
    )
      return;
    const drift = temperate
      ? 0.65 + 0.35 * forestWeight(x * 3.1, z * 2.7)
      : tundra
        ? clamp01((forestWeight(x * 9.8, z * 8.7) - 0.47) / 0.3) *
          clamp01((forestWeight(x * 10.1, z * 8.7) - 0.2) / 0.5)
        : desert
          ? 0.08 + 0.6 * clamp01((forestWeight(x * 6.3, z * 5.7) - 0.5) / 0.3)
          : clamp01((forestWeight(x * 2.1, z * 2.4) - 0.3) / 0.45);
    if (random() > density * drift) return;
    put(
      "grass",
      x,
      z,
      (data.world === "coastal" && clampedHeight(data, x, z) < (data.waterLevel ?? 0) + 7.5
        ? 2.2
        : temperate
          ? 0.8
          : tundra
            ? 0.45
            : desert
              ? 0.95
              : 0.55) +
        random() * (temperate ? 0.65 : tundra ? 0.3 : 0.5),
    );
    if (desert) {
      for (let tuft = 0; tuft < 3; tuft++)
        put(
          "grass",
          x + (random() - 0.5) * 1.4,
          z + (random() - 0.5) * 1.4,
          0.65 + random() * 0.55,
        );
    }
    if (random() < (desert ? 0.65 : tundra ? 0.95 : 0.3))
      put(
        "scrub",
        x + (random() - 0.5),
        z + (random() - 0.5),
        (desert ? 0.8 : tundra ? 0.55 : 0.9) + random() * (tundra ? 0.5 : 0.6),
      );
    if (tundra && random() < 0.02)
      put("bush", x + (random() - 0.5) * 2, z + (random() - 0.5) * 2, 0.6 + random() * 0.45);
  };
  // A cheap carpet on every grass cell; dense detail at all walking/benchmark eyes, not one disc.
  for (
    let z = -half + 3;
    z < half - 3;
    z += temperate ? SCATTER.grassCell : desert ? 7 : tundra ? 1.8 : 3.5
  )
    for (
      let x = -half + 3;
      x < half - 3;
      x += temperate ? SCATTER.grassCell : desert ? 7 : tundra ? 1.8 : 3.5
    )
      cover(
        x + (random() - 0.5) * (temperate ? 1.5 : desert ? 6 : tundra ? 1.7 : 3),
        z + (random() - 0.5) * (temperate ? 1.5 : desert ? 6 : tundra ? 1.7 : 3),
        0.7,
      );
  const eyes = [focus, ...clearings.map(([x, z]) => ({ x, z }))];
  for (const eye of eyes) {
    // The forest's thinned walking-eye carpet stays as tuned; other biomes take their own spacing.
    const eyeStep = temperate ? 0.34 : desert ? 1.8 : tundra ? 0.5 : 0.6;
    const eyeReach = temperate ? SCATTER.grassThin : SCATTER.grassFull + 22;
    for (let dz = -eyeReach; dz < eyeReach; dz += eyeStep)
      for (let dx = -eyeReach; dx < eyeReach; dx += eyeStep) {
        const distance = Math.hypot(dx, dz);
        if (distance > eyeReach) continue;
        const density = Math.max(
          0.08,
          1 - Math.max(0, distance - SCATTER.grassFull) / (eyeReach - SCATTER.grassFull),
        );
        cover(eye.x + dx + (random() - 0.5) * 0.6, eye.z + dz + (random() - 0.5) * 0.6, density);
      }
    for (let p = 0; p < (temperate ? 14 : 0); p++) {
      const angle = random() * Math.PI * 2;
      const reach = random() * 32;
      const px = eye.x + Math.cos(angle) * reach;
      const pz = eye.z + Math.sin(angle) * reach;
      if (forestWeight(px, pz) > 0.62 && !nearEye(px, pz)) continue;
      const radius = 2.5 + random() * 3.5;
      for (let k = 0; k < 100; k++) {
        const x = px + (random() - 0.5) * radius * 2;
        const z = pz + (random() - 0.5) * radius * 2;
        if (
          Math.hypot(x - px, z - pz) > radius ||
          slopeDegrees(data, x, z) > 28 ||
          grassWeight(data, x, z) < 0.4
        )
          continue;
        put("poppy", x, z, 0.8 + random() * 0.4);
      }
    }
  }
  if (temperate) {
    // Separate seed: dressing the rock/shore never reshuffles the established stands.
    const dressing = createRandom(SCATTER.seed + 12);
    for (let z = -half + 12; z < half - 12; z += 12)
      for (let x = -half + 12; x < half - 12; x += 12) {
        const sx = x + (dressing() - 0.5) * 10;
        const sz = z + (dressing() - 0.5) * 10;
        const slope = slopeDegrees(data, sx, sz);
        const height = clampedHeight(data, sx, sz);
        const shore =
          data.waterLevel !== null &&
          height > data.waterLevel + 0.4 &&
          height < data.waterLevel + 7;
        if (nearEye(sx, sz) || wet(sx, sz)) continue;
        if (shore && slope > 12 && dressing() < 0.65)
          put("mountain", sx, sz, (5 + dressing() * 10) / 24, ":outcrop");
        else if (slope > 30 && slope < 64 && dressing() < 0.6)
          put("mountain", sx, sz, (10 + dressing() * 10) / 24, ":outcrop");
      }
  }
  return { counts, placements };
}
