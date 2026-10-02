/** Game-owned biome choices; all five worlds share the same rendering and collision paths. */
import {
  float,
  mix,
  mx_fractal_noise_float,
  mx_worley_noise_vec2,
  normalWorldGeometry,
  positionWorld,
  smoothstep,
  vec3,
} from "three/tsl";
import type { Node } from "three/webgpu";
import { GROUND_MAPS, type IGroundMaps, type LayerKey } from "../world/terrainAssets.js";

export type WorldName = "forest" | "coastal" | "alpine" | "desert" | "tundra";
type RGB = readonly [number, number, number];

export interface IBiome {
  readonly world: WorldName;
  readonly grassTint: RGB;
  readonly stoneTint: RGB;
  readonly snowTint: RGB;
  readonly distantStone: RGB;
  readonly snow: readonly [number, number, number];
  readonly maps: Record<LayerKey, IGroundMaps>;
  readonly horizon: "mountain" | "alpine" | "mesa" | "plain";
  readonly sun: { readonly color: number; readonly intensity: number; readonly direction: RGB };
  readonly sky: {
    turbidity: number;
    rayleigh: number;
    mieCoefficient: number;
    mieDirectionalG: number;
  };
  readonly fill: { readonly sky: number; readonly ground: number; readonly intensity: number };
  readonly haze: { readonly color: number; readonly density: number };
  readonly exposure: number;
  readonly clouds: number;
}

const temperate: IBiome = {
  world: "forest",
  grassTint: [0.43, 0.76, 0.38],
  stoneTint: [0.48, 0.44, 0.39],
  snowTint: [1, 1, 1],
  distantStone: [0.115, 0.105, 0.088],
  snow: [145, 195, 0.22],
  maps: GROUND_MAPS,
  horizon: "mountain",
  sun: { color: 0xffeed0, intensity: 4.6, direction: [-180, 150, -120] },
  sky: { turbidity: 2, rayleigh: 3, mieCoefficient: 0.003, mieDirectionalG: 0.82 },
  fill: { sky: 0xa8c8e8, ground: 0x464937, intensity: 0.62 },
  haze: { color: 0x8ca8ba, density: 0.0008 },
  exposure: 2 ** -0.38,
  clouds: 0.76,
};

export const BIOMES: Record<WorldName, IBiome> = {
  forest: temperate,
  coastal: { ...temperate, world: "coastal" },
  alpine: {
    ...temperate,
    world: "alpine",
    horizon: "alpine",
    grassTint: [0.43, 0.8, 0.35],
    stoneTint: [0.69, 0.72, 0.77],
    snowTint: [2.65, 2.7, 2.8],
    distantStone: [0.23, 0.225, 0.215],
    snow: [64, 100, 0.39],
    maps: {
      ...GROUND_MAPS,
      snow: { ...GROUND_MAPS.snow, normal: "snow_02/snow_02_nor_gl_1k.jpg" },
      moss: { diffuse: GROUND_MAPS.moss.diffuse },
      dirt: {
        diffuse: "river_small_rocks/river_small_rocks_diff_512.jpg",
        normal: "river_small_rocks/river_small_rocks_nor_gl_512.jpg",
      },
      rock: GROUND_MAPS.rock,
    },
    sun: { color: 0xfff3e5, intensity: 4.6, direction: [-180, 165, 80] },
    sky: { turbidity: 1.3, rayleigh: 2.1, mieCoefficient: 0.0018, mieDirectionalG: 0.8 },
    haze: { color: 0x9aafc3, density: 0.00035 },
    fill: { sky: 0xb2c6de, ground: 0x656963, intensity: 0.65 },
    clouds: 0.34,
  },
  desert: {
    ...temperate,
    world: "desert",
    horizon: "mesa",
    grassTint: [1, 1, 1],
    stoneTint: [1.16, 0.82, 0.55],
    distantStone: [0.31, 0.205, 0.12],
    snow: [10000, 10001, 0.22],
    maps: {
      ...GROUND_MAPS,
      grass: { ...GROUND_MAPS.sand, normal: "sand_01/sand_01_nor_gl_1k.jpg" },
      dirt: {
        diffuse: "river_small_rocks/river_small_rocks_diff_512.jpg",
        normal: "river_small_rocks/river_small_rocks_nor_gl_512.jpg",
      },
      moss: {
        diffuse: "cliff_side/cliff_side_diff_1k.jpg",
        normal: "cliff_side/cliff_side_nor_gl_1k.jpg",
      },
      rock: GROUND_MAPS.rock,
    },
    sun: { color: 0xffe0ad, intensity: 4.8, direction: [160, 140, 85] },
    sky: { turbidity: 3.5, rayleigh: 1.4, mieCoefficient: 0.006, mieDirectionalG: 0.8 },
    fill: { sky: 0xc2d3db, ground: 0x9e7147, intensity: 0.55 },
    haze: { color: 0xd1b99b, density: 0.0011 },
    exposure: 2 ** -0.48,
    clouds: 0.12,
  },
  tundra: {
    ...temperate,
    world: "tundra",
    horizon: "plain",
    grassTint: [0.94, 0.91, 0.67],
    stoneTint: [0.7, 0.74, 0.77],
    snowTint: [1.2, 1.24, 1.28],
    distantStone: [0.18, 0.2, 0.21],
    snow: [17, 30, 0.18],
    maps: {
      ...GROUND_MAPS,
      snow: { ...GROUND_MAPS.snow, normal: "snow_02/snow_02_nor_gl_1k.jpg" },
      grass: {
        diffuse: "lichen_rock/lichen_rock_diff_512.jpg",
        normal: "lichen_rock/lichen_rock_nor_gl_512.jpg",
      },
      dirt: {
        diffuse: "river_small_rocks/river_small_rocks_diff_512.jpg",
      },
      moss: {
        diffuse: "lichen_rock/lichen_rock_diff_512.jpg",
        normal: "lichen_rock/lichen_rock_nor_gl_512.jpg",
      },
    },
    sun: { color: 0xe9efff, intensity: 0.75, direction: [-180, 90, -120] },
    sky: { turbidity: 10, rayleigh: 0.4, mieCoefficient: 0.018, mieDirectionalG: 0.78 },
    fill: { sky: 0xb9ccdf, ground: 0x555851, intensity: 1.15 },
    haze: { color: 0xb1c0c9, density: 0.00065 },
    exposure: 2 ** -0.28,
    clouds: 0.9,
  },
};

/** Local ground rules; slope keeps steep faces bare and noise breaks the snow's contour line. */
export function biomeWeights(
  biome: IBiome,
  steep: Node<"float">,
  hollow: Node<"float">,
  breakup: Node<"float">,
): Partial<Record<LayerKey, Node<"float">>> {
  if (biome.world === "forest" || biome.world === "coastal") return {};
  const drift = mx_fractal_noise_float(positionWorld.mul(0.033), 3);
  const stone = smoothstep(0.1, 0.29, steep.add(breakup.mul(0.04)));
  if (biome.world === "desert")
    return {
      dirt: smoothstep(0.14, 0.65, hollow).mul(0.7),
      moss: float(0),
      sand: float(0),
      rock: stone
        .max(smoothstep(25, 65, positionWorld.y).mul(0.48))
        .mul(float(1).sub(smoothstep(0.12, 0.5, hollow).mul(0.35))),
      snow: float(0),
    };
  // Wind-scoured convex/exposed faces shed snow; sheltered shelves keep it.
  const exposure = normalWorldGeometry.x.mul(0.65).add(normalWorldGeometry.z.mul(0.4)).max(0);
  const snow = smoothstep(
    biome.snow[0],
    biome.snow[1],
    positionWorld.y.add(drift.mul(22)).add(hollow.max(0).mul(biome.world === "alpine" ? 18 : 0)),
  ).mul(
    float(1)
      .sub(smoothstep(biome.world === "alpine" ? 0.2 : 0.04, biome.snow[2], steep))
      .mul(float(1).sub(exposure.mul(0.28))),
  );
  const cells = mx_worley_noise_vec2(
    vec3(positionWorld.x, 0, positionWorld.z).mul(0.13).add(drift.mul(0.35)),
  );
  const polygon = smoothstep(0.025, 0.11, cells.y.sub(cells.x));
  return {
    dirt:
      biome.world === "tundra"
        ? smoothstep(0.08, 0.5, hollow).mul(0.45).max(polygon.oneMinus().mul(0.7))
        : smoothstep(0.08, 0.5, hollow).mul(0.55),
    moss:
      biome.world === "tundra"
        ? smoothstep(-0.18, 0.25, drift)
            .mul(snow.oneMinus())
            .mul(mix(0.38, 0.82, polygon))
        : float(0),
    rock:
      biome.world === "alpine"
        ? stone
            .max(smoothstep(40, 90, positionWorld.y).mul(0.58))
            .max(
              smoothstep(0.12, 0.5, hollow)
                .mul(smoothstep(35, 80, positionWorld.y))
                .mul(0.45),
            )
            .mul(float(1).sub(smoothstep(0.08, 0.4, hollow).mul(0.4)))
        : stone,
    snow: biome.world === "tundra" ? snow.mul(mix(0.42, 1, smoothstep(-0.22, 0.25, drift))) : snow,
  };
}
