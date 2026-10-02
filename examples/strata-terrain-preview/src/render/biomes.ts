import type { Texture } from "three";
/** Game-owned biome choices; all five worlds share the same rendering and collision paths. */
import {
  abs,
  dot,
  float,
  mix,
  mx_fractal_noise_float,
  mx_noise_float,
  mx_worley_noise_vec2,
  normalWorldGeometry,
  positionWorld,
  rotateUV,
  smoothstep,
  texture,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { Node } from "three/webgpu";
import {
  GROUND_MAPS,
  type IGroundMaps,
  type LayerKey,
  ROCKFACE_MAPS,
} from "../world/terrainAssets.js";

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
    stoneTint: [0.86, 0.88, 0.9],
    snowTint: [1.6, 1.65, 1.7],
    distantStone: [0.23, 0.225, 0.215],
    snow: [54, 88, 0.39],
    maps: {
      ...GROUND_MAPS,
      snow: { ...GROUND_MAPS.snow, normal: "snow_02/snow_02_nor_gl_1k.jpg" },
      moss: { diffuse: GROUND_MAPS.moss.diffuse },
      dirt: {
        diffuse: "river_small_rocks/river_small_rocks_diff_512.jpg",
        normal: "river_small_rocks/river_small_rocks_nor_gl_512.jpg",
      },
      rock: ROCKFACE_MAPS,
    },
    sun: { color: 0xfff3e5, intensity: 4.6, direction: [180, 165, 140] },
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
    grassTint: [0.83, 0.88, 0.82],
    stoneTint: [0.7, 0.74, 0.77],
    snowTint: [1.2, 1.24, 1.28],
    distantStone: [0.18, 0.2, 0.21],
    snow: [17, 30, 0.18],
    maps: {
      ...GROUND_MAPS,
      snow: { ...GROUND_MAPS.snow, normal: "snow_02/snow_02_nor_gl_1k.jpg" },
      grass: {
        diffuse: "river_small_rocks/river_small_rocks_diff_512.jpg",
        normal: "river_small_rocks/river_small_rocks_nor_gl_512.jpg",
      },
      dirt: {
        diffuse: "river_small_rocks/river_small_rocks_diff_512.jpg",
      },
      moss: {
        diffuse: "lichen_rock/lichen_rock_diff_512.jpg",
        normal: "lichen_rock/lichen_rock_nor_gl_512.jpg",
      },
    },
    sun: { color: 0xe9efff, intensity: 1.6, direction: [-180, 90, -120] },
    sky: { turbidity: 4.2, rayleigh: 1.6, mieCoefficient: 0.002, mieDirectionalG: 0.68 },
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
      .sub(
        smoothstep(
          biome.world === "alpine" ? 0.16 : 0.04,
          biome.world === "alpine" ? 0.33 : biome.snow[2],
          steep,
        ),
      )
      .mul(float(1).sub(exposure.mul(0.28))),
  );
  const cells = mx_worley_noise_vec2(
    vec3(positionWorld.x, 0, positionWorld.z).mul(0.13).add(drift.mul(0.35)),
  );
  const polygon = smoothstep(0.025, 0.11, cells.y.sub(cells.x));
  const mats = smoothstep(
    0.48,
    0.78,
    float(0.52)
      .add(positionWorld.x.mul(0.049).add(positionWorld.z.mul(0.0216)).sin().mul(0.27))
      .add(positionWorld.z.mul(0.0516).sub(positionWorld.x.mul(0.0238)).add(1.3).sin().mul(0.24))
      .add(positionWorld.x.mul(0.0994).add(positionWorld.z.mul(0.0732)).sin().mul(0.12)),
  );
  return {
    dirt:
      biome.world === "tundra"
        ? smoothstep(0.08, 0.5, hollow)
            .mul(0.28)
            .max(polygon.oneMinus().mul(0.3))
            .mul(mats.oneMinus())
        : smoothstep(0.08, 0.5, hollow).mul(0.55),
    moss:
      biome.world === "tundra" ? mats.mul(snow.oneMinus()).mul(mix(0.72, 0.98, polygon)) : float(0),
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
    snow:
      biome.world === "tundra"
        ? snow.mul(mix(0.42, 1, smoothstep(-0.22, 0.25, drift)))
        : alpineSnowCover(),
  };
}

/** One world-space RockFace003 projection on both the massif and its protruding ribs. */
export function alpineRockTap(source: Texture, plane: Node<"vec2">, relief = false): Node<"vec4"> {
  const tap = (scale: number, angle: number, offset: Node<"vec2">) => {
    const sampled = texture(source, rotateUV(plane.div(scale), float(angle), vec2(0)).add(offset));
    if (!relief) return sampled;
    const tangent = rotateUV(sampled.xy.mul(2).sub(1), float(-angle), vec2(0));
    return vec4(tangent, sampled.z.mul(2).sub(1), 1);
  };
  const patch = smoothstep(-0.35, 0.35, mx_noise_float(positionWorld.mul(0.025)));
  return mix(tap(8, 0.17, vec2(0)), tap(32, -0.21, vec2(0.37, 0.61)), patch.mul(0.3).add(0.2));
}

export function alpineRockAlbedo(source: Texture): Node<"vec3"> {
  const axis = abs(normalWorldGeometry).pow(4);
  const share = axis.div(axis.x.add(axis.y).add(axis.z));
  return share.x
    .mul(alpineRockTap(source, positionWorld.zy).rgb)
    .add(share.y.mul(alpineRockTap(source, positionWorld.xz).rgb))
    .add(share.z.mul(alpineRockTap(source, positionWorld.xy).rgb));
}

export function alpineRockColor(sample: Node<"vec3">): Node<"vec3"> {
  const grey = dot(sample, vec3(0.2126, 0.7152, 0.0722));
  return mix(sample, vec3(grey), 0.25).mul(vec3(...BIOMES.alpine.stoneTint));
}

/** Snow respects world elevation and upward faces, including tilted instanced scans. */
export function alpineSnowCover(): Node<"float"> {
  const drift = mx_fractal_noise_float(positionWorld.mul(0.033), 3);
  const exposure = normalWorldGeometry.x.mul(0.65).add(normalWorldGeometry.z.mul(0.4)).max(0);
  return smoothstep(54, 88, positionWorld.y.add(drift.mul(22)))
    .mul(smoothstep(0.67, 0.84, normalWorldGeometry.y))
    .mul(float(1).sub(exposure.mul(0.28)));
}

/** Thin sediment beds have varying thickness; varnish runs down, not around, a wall. */
export function desertRockColor(sample: Node<"vec3">): Node<"vec3"> {
  const grain = dot(sample, vec3(0.2126, 0.7152, 0.0722));
  const warp = mx_fractal_noise_float(positionWorld.mul(vec3(0.012, 0.003, 0.012)), 3).mul(5);
  const height = positionWorld.y.add(warp);
  const beds = mx_noise_float(vec3(0, height.mul(1.55), 0));
  const fine = height.mul(4.1).add(beds.mul(2.8)).sin().mul(0.035);
  const ledge = smoothstep(0.38, 0.62, mx_noise_float(vec3(0, height.mul(0.19), 0))).mul(0.11);
  const varnish = smoothstep(
    -0.18,
    0.28,
    mx_fractal_noise_float(positionWorld.mul(vec3(0.42, 0.004, 0.42)), 3),
  )
    .mul(normalWorldGeometry.y.abs().oneMinus())
    .mul(0.18);
  return vec3(1.52, 0.9, 0.5)
    .mul(grain)
    .mul(beds.mul(0.11).add(fine).add(1).sub(ledge))
    .mul(mix(vec3(1), vec3(0.55, 0.48, 0.42), varnish));
}
