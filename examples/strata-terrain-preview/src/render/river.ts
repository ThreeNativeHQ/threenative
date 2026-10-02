// The Temperate river: the water that fills the channel the bake carved.
//
// The bake cuts the bed and records the river's path; nothing drew water in it, so the world had a
// dry trench with a mud floor. This file is the water, and every decision about how it looks is
// here: the surface sits a fixed fill above the bed it was carved into, the ripples move downstream
// at the river's own heading, and the colour is the bed seen through the water, darkened by how
// much water stands over it — which is what `WaterSurface3D` measures in metres.
//
// No mirror. A reflection pass mirrors about one level, and this surface falls fifteen metres over
// its length, so a planar reflection would be right at one bend and wrong everywhere else. The sky
// comes back by fresnel instead, which is what a moving river surface mostly shows anyway.
import { WaterSurface3D } from "@threenative/core";
import type { Heightfield } from "@threenative/core/world";
import { BufferAttribute, BufferGeometry, CircleGeometry, Mesh } from "three";
import {
  attribute,
  cameraPosition,
  clamp,
  color,
  dot,
  float,
  mix,
  mx_noise_float,
  normalize,
  positionWorld,
  pow,
  smoothstep,
  transformNormalToView,
  uniform,
  vec3,
} from "three/tsl";
import type { Node } from "three/webgpu";
import { MeshStandardNodeMaterial } from "three/webgpu";

/** One river as the bake records it: the smoothed spline and the width of its water. */
export interface IBakedRiver {
  readonly id: string;
  readonly points: readonly (readonly number[])[];
  readonly width: number;
}

/**
 * The layer water draws on, and the only one the lake's mirror leaves out.
 *
 * Water reads the frame's depth to know how deep it is, and inside the mirror pass that depth is the
 * mirror's own single-sampled target: drawing a water surface into the mirror fails WebGPU validation
 * and takes the frame down with it. Water in a lake's reflection is the lake itself anyway.
 */
export const WATER_LAYER = 1;

/** The river's look. Every number is this game's. */
const RIVER = {
  /** Metres of water over the deepest point of the bed. The bank rises out of it on its own. */
  fill: 1.1,
  /** How far either side of the centreline the surface reaches; the terrain hides what is dry. */
  reach: 13,
  /** Vertices across the surface. Enough for the bank to cut a curved shoreline, not a ruler. */
  across: 11,
  /** Metres of water past which the bed no longer shows through. */
  murk: 2.2,
  /** Downstream drift of the broad and fine ripples, metres a second. */
  flow: [0.55, 1.15],
  /** How hard the ripples bend the surface. */
  ripple: 0.32,
  bedTint: 0x9fb08f,
  deep: 0x1f3833,
  skyHorizon: 0xb7c5cc,
  skyZenith: 0x7d98ac,
  foam: 0xe4ece6,
} as const;

/** The water surface's height along the path: a fill over the bed, never running uphill. */
function surfaceHeights(field: Heightfield, points: readonly (readonly number[])[]): number[] {
  const raw = points.map(([x = 0, , z = 0]) => field.heightAt(x, z) + RIVER.fill);
  // Downhill only, then a short moving average, then downhill again: the bed has erosion noise in
  // it and a surface that copies that noise steps up and down like a staircase.
  for (let k = 1; k < raw.length; k += 1) raw[k] = Math.min(raw[k] as number, raw[k - 1] as number);
  const smooth = raw.map((_, k) => {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, k - 3); j <= Math.min(raw.length - 1, k + 3); j += 1) {
      sum += raw[j] as number;
      n += 1;
    }
    return sum / n;
  });
  for (let k = 1; k < smooth.length; k += 1)
    smooth[k] = Math.min(smooth[k] as number, smooth[k - 1] as number);
  return smooth;
}

/** A ribbon along one river: positions, and the downstream heading at every vertex. */
function ribbon(
  field: Heightfield,
  river: IBakedRiver,
  positions: number[],
  flows: number[],
  indices: number[],
): void {
  const { points } = river;
  const heights = surfaceHeights(field, points);
  const base = positions.length / 3;
  const columns = RIVER.across;
  for (let k = 0; k < points.length; k += 1) {
    const before = points[Math.max(0, k - 1)] as readonly number[];
    const after = points[Math.min(points.length - 1, k + 1)] as readonly number[];
    let dx = (after[0] ?? 0) - (before[0] ?? 0);
    let dz = (after[2] ?? 0) - (before[2] ?? 0);
    const length = Math.hypot(dx, dz) || 1;
    dx /= length;
    dz /= length;
    const [x = 0, , z = 0] = points[k] as readonly number[];
    const y = heights[k] as number;
    for (let c = 0; c < columns; c += 1) {
      const across = (c / (columns - 1) - 0.5) * 2 * RIVER.reach;
      positions.push(x - dz * across, y, z + dx * across);
      flows.push(dx, dz);
    }
  }
  for (let k = 1; k < points.length; k += 1) {
    for (let c = 1; c < columns; c += 1) {
      const a = base + (k - 1) * columns + c - 1;
      const b = a + 1;
      const d = base + k * columns + c - 1;
      const e = d + 1;
      // Wound so the face points up: along × across points down, so the pair is taken the other way.
      indices.push(a, b, d, b, e, d);
    }
  }
}

export interface IRiverWater {
  readonly mesh: Mesh;
  /** The river's clock, in seconds; the scene advances it so the playtest's time is the water's. */
  advance(elapsed: number): void;
  dispose(): void;
}

/** Draw every baked river as one surface, or nothing when the world has none. */
export function createRivers(
  rivers: readonly IBakedRiver[],
  field: Heightfield,
): IRiverWater | undefined {
  if (rivers.length === 0) return undefined;
  const positions: number[] = [];
  const flows: number[] = [];
  const indices: number[] = [];
  for (const river of rivers) ribbon(field, river, positions, flows, indices);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("flow", new BufferAttribute(new Float32Array(flows), 2));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const surface = new WaterSurface3D({ level: 0, maxThickness: RIVER.murk * 2 });
  const time = uniform(0);
  const heading = normalize(attribute<"vec2">("flow", "vec2"));
  const along = dot(positionWorld.xz, heading);
  const side = dot(positionWorld.xz, vec3(heading.y.negate(), heading.x, 0).xy);

  // Ripples are noise stretched along the current and slid downstream: long streaks that move,
  // which is what tells a river from a pond at a glance.
  const height = (a: Node<"float">, b: Node<"float">): Node<"float"> =>
    mx_noise_float(
      vec3(a.mul(0.16).sub(time.mul(RIVER.flow[0] * 0.16)), b.mul(0.42), time.mul(0.04)),
    )
      .mul(0.7)
      .add(
        mx_noise_float(
          vec3(a.mul(0.85).sub(time.mul(RIVER.flow[1] * 0.85)), b.mul(1.3), time.mul(0.15)),
        ).mul(0.3),
      ) as Node<"float">;
  const step = 0.35;
  const h0 = height(along, side);
  const dA = height(along.add(step), side).sub(h0).div(step);
  const dB = height(along, side.add(step)).sub(h0).div(step);
  // Back from the current's frame into the world's.
  const gx = heading.x.mul(dA).sub(heading.y.mul(dB));
  const gz = heading.y.mul(dA).add(heading.x.mul(dB));
  const normal = normalize(vec3(gx.mul(-RIVER.ripple), float(1), gz.mul(-RIVER.ripple)));

  const thickness = surface.thicknessAt();
  const offset = normal.xz.mul(0.035);
  const bed = surface.refractionAt(offset).mul(color(RIVER.bedTint));
  const murk = smoothstep(float(0), float(RIVER.murk), thickness);
  const water = mix(bed, color(RIVER.deep), murk);

  const view = normalize(cameraPosition.sub(positionWorld));
  const facing = clamp(dot(normal, view), 0, 1);
  const fresnel = float(0.02).add(pow(float(1).sub(facing), 5).mul(0.98));
  const reflected = view.negate().reflect(normal);
  const sky = mix(color(RIVER.skyHorizon), color(RIVER.skyZenith), clamp(reflected.y, 0, 1));
  const surfaceColour = mix(water, sky, fresnel.mul(0.9));

  // White water where the current runs over a shallow bed, and a few streaks in the channel.
  const churn = mx_noise_float(
    vec3(along.mul(0.6).sub(time.mul(1.1)), side.mul(0.9), time.mul(0.3)),
  )
    .mul(0.5)
    .add(0.5);
  // Broken, not ruled: the shallows only whiten where the churn is high, so the edge reads as water
  // catching on the bed in patches rather than as a white line painted along the bank.
  const shallows = float(1).sub(
    smoothstep(float(0.02), float(0.16).add(churn.mul(0.22)), thickness),
  );
  const bank = shallows.mul(smoothstep(float(0.45), float(0.8), churn)).mul(0.65);
  const streak = smoothstep(float(0.74), float(0.88), h0.mul(0.5).add(0.5)).mul(0.16);
  const foam = bank.max(streak.mul(murk));

  const material = new MeshStandardNodeMaterial({
    metalness: 0,
    roughness: 0.07,
    transparent: true,
    depthWrite: false,
  });
  // The water's own colour is light coming *through* it, already lit by the frame beneath, so it
  // goes in as emission; the lit channel carries only the foam and the sun's glint on the surface.
  material.colorNode = color(RIVER.foam).mul(foam);
  material.emissiveNode = surfaceColour.mul(float(1).sub(foam));
  material.roughnessNode = mix(float(0.07), float(0.8), foam);
  material.normalNode = transformNormalToView(normal);
  // A metre-wide fade at the shoreline instead of the bank cutting the surface like a blade.
  material.opacityNode = smoothstep(float(0), float(0.12), thickness);

  const mesh = new Mesh(geometry, material);
  mesh.layers.set(WATER_LAYER);
  mesh.name = "river-surface";
  mesh.receiveShadow = true;
  return {
    mesh,
    advance(elapsed) {
      time.value = elapsed;
    },
    dispose() {
      surface.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}

/** One lake as the bake records it: where its flood fill was seeded, how far it may reach, its level. */
export interface IBakedLake {
  readonly id: string;
  readonly at: readonly number[];
  readonly radius: number;
  readonly level: number;
}

/** The lake's look. Still water: the reflection is most of it. */
const LAKE = {
  /** Mirror pixels as a share of the frame's, and how often it is redrawn. */
  mirror: { resolutionScale: 0.5, refreshInterval: 2 },
  murk: 3.5,
  ripple: 0.09,
  bedTint: 0x8fa080,
  deep: 0x1c3533,
} as const;

/**
 * Draw every baked lake as a flat disc at its level, mirrored and seen through.
 *
 * Unlike the river a lake *is* level, so it gets a real planar reflection: the shore, the spruces and
 * the sky upside down in it is what makes still water read as water at all. The disc is the bake's
 * flood radius and the terrain hides the parts of it that are dry land, so the shoreline is the
 * ground's own contour.
 */
export function createLakes(lakes: readonly IBakedLake[]): IRiverWater | undefined {
  const lake = lakes[0];
  if (lake === undefined) return undefined;
  if (lakes.length > 1) throw new Error("The Temperate lake surface draws one lake; got more.");
  const geometry = new CircleGeometry(lake.radius, 128);
  geometry.rotateX(-Math.PI / 2);
  const surface = new WaterSurface3D({
    level: lake.level,
    maxThickness: LAKE.murk * 2,
    // Everything but water: the camera sees layer 0 and WATER_LAYER, the mirror only layer 0.
    reflection: { ...LAKE.mirror, layers: 1 },
  });
  const time = uniform(0);
  // Cat's-paws: two slow drifting noises, barely tilting the surface, so the mirror wavers instead of
  // being a sheet of glass.
  const ripple = (x: Node<"float">, z: Node<"float">): Node<"float"> =>
    mx_noise_float(vec3(x.mul(0.22).add(time.mul(0.05)), z.mul(0.22), time.mul(0.08)))
      .mul(0.6)
      .add(
        mx_noise_float(vec3(x.mul(1.1), z.mul(1.1).sub(time.mul(0.12)), time.mul(0.2))).mul(0.4),
      ) as Node<"float">;
  const step = 0.3;
  const px = positionWorld.x;
  const pz = positionWorld.z;
  const h0 = ripple(px, pz);
  const gx = ripple(px.add(step), pz).sub(h0).div(step);
  const gz = ripple(px, pz.add(step)).sub(h0).div(step);
  const normal = normalize(vec3(gx.mul(-LAKE.ripple), float(1), gz.mul(-LAKE.ripple)));
  const offset = normal.xz.mul(0.04);
  const thickness = surface.thicknessAt();
  const bed = surface.refractionAt(offset).mul(color(LAKE.bedTint));
  const water = mix(bed, color(LAKE.deep), smoothstep(float(0), float(LAKE.murk), thickness));
  const view = normalize(cameraPosition.sub(positionWorld));
  const facing = clamp(dot(normal, view), 0, 1);
  const fresnel = float(0.02).add(pow(float(1).sub(facing), 5).mul(0.98));
  const mirrored = surface.reflectionAt(offset);
  const material = new MeshStandardNodeMaterial({
    metalness: 0,
    roughness: 0.05,
    transparent: true,
    depthWrite: false,
  });
  material.colorNode = color(0x000000);
  // A little of the mirror shows even looking straight down: still water reflects a few per cent at
  // normal incidence, and a lake with none reads as tinted glass.
  material.emissiveNode = mix(water, mirrored, fresnel.mul(0.85).add(0.06));
  material.normalNode = transformNormalToView(normal);
  material.opacityNode = smoothstep(float(0), float(0.15), thickness);
  const mesh = new Mesh(geometry, material);
  mesh.layers.set(WATER_LAYER);
  mesh.position.set(lake.at[0] ?? 0, lake.level, lake.at[1] ?? 0);
  mesh.name = "lake-surface";
  mesh.receiveShadow = true;
  return {
    mesh,
    advance(elapsed) {
      time.value = elapsed;
    },
    dispose() {
      surface.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
