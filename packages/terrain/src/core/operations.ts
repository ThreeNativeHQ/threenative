import { hydraulic, thermal } from "./erosion.js";
import { MATERIAL_IDS, compileMask, paintWeights, rasterMask } from "./masks.js";
import {
  clamp,
  falloff,
  fbm,
  gradientAt,
  hashString,
  lerp,
  noise2,
  random,
  sampleGrid,
  sampleHeight,
  smoothstep,
  splinePoints,
  world,
} from "./math.js";
import type {
  IBrushParams,
  IHeightData,
  IPlacement,
  IScatterClear,
  ITerrainConfig,
  ITerrainState,
  Layer,
  MaterialId,
  OperationType,
} from "./types.js";

/** Every operation the evaluator applies, in application order. */
export const OPERATION_TYPES: readonly OperationType[] = Object.freeze([
  "noise",
  "sculpt",
  "smooth",
  "flatten",
  "ramp",
  "stamp",
  "erode",
  "terrace",
  "materials",
  "paint",
  "biome",
  "scatter",
  "clear",
  "road",
  "river",
  "water",
  "heightmap",
  "paste",
]);

/** The blank state every evaluation starts from; the first channel is grass. */
export function createState(config: ITerrainConfig, resolution = config.resolution): ITerrainState {
  const height = new Float32Array(resolution * resolution);
  const splat = new Float32Array(height.length * 8);
  for (let i = 0; i < height.length; i += 1) splat[i * 8] = 1;
  return {
    size: config.size,
    resolution,
    seed: config.seed,
    height,
    splat,
    biomes: {},
    scatterRules: [],
    waterRules: [],
    rivers: [],
    instances: [],
    waters: [],
    diagnostics: [],
  };
}

/**
 * Brush centres for one stroke: the given centre or an interpolated polyline at
 * `2 * radius * spacing`, with optional seeded jitter. Coverage uses these centres once rather
 * than accumulating per input event.
 */
function brushCenters(p: IBrushParams, seed: number): [number, number][] | null {
  const source = p.points ?? (p.at ? [p.at] : null);
  if (!source) return null;
  const radius = p.radius ?? 30;
  const first = source[0];
  if (!first) return null;
  const out: [number, number][] = [[first[0], first[1]]];
  const step = Math.max(0.1, radius * 2 * (p.spacing ?? 0.15));
  for (let k = 1; k < source.length; k += 1) {
    const a = source[k - 1] as readonly [number, number];
    const b = source[k] as readonly [number, number];
    const count = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let j = 1; j <= count; j += 1)
      out.push([lerp(a[0], b[0], j / count), lerp(a[1], b[1], j / count)]);
  }
  if (p.jitter) {
    const rnd = random(seed);
    for (const centre of out) {
      const angle = rnd() * Math.PI * 2;
      const offset = Math.sqrt(rnd()) * p.jitter * radius;
      centre[0] += Math.cos(angle) * offset;
      centre[1] += Math.sin(angle) * offset;
    }
  }
  return out;
}

/** Rasterized brush coverage, multiplied by the layer mask. */
function brushWeights(
  s: ITerrainState,
  p: IBrushParams,
  mask: Float32Array | null,
  seed: number,
): Float32Array {
  const centers = brushCenters(p, seed);
  if (!centers) return mask ?? new Float32Array(s.height.length);
  const n = s.resolution;
  const r = p.radius ?? 30;
  const cell = s.size / (n - 1);
  const weights = new Float32Array(n * n);
  const angle = ((p.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const bound = r * (p.shape === "square" ? Math.SQRT2 : 1);
  for (const [cx, cz] of centers) {
    const x0 = clamp(Math.floor((cx - bound + s.size / 2) / cell), 0, n - 1);
    const x1 = clamp(Math.ceil((cx + bound + s.size / 2) / cell), 0, n - 1);
    const z0 = clamp(Math.floor((cz - bound + s.size / 2) / cell), 0, n - 1);
    const z1 = clamp(Math.ceil((cz + bound + s.size / 2) / cell), 0, n - 1);
    for (let z = z0; z <= z1; z += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const dx = world(s, x) - cx;
        const dz = world(s, z) - cz;
        const distance =
          p.shape === "square"
            ? Math.max(Math.abs(dx * cos + dz * sin), Math.abs(-dx * sin + dz * cos))
            : Math.hypot(dx, dz);
        const i = z * n + x;
        weights[i] = Math.max(
          weights[i] as number,
          falloff(distance, r, p.falloff ?? 0.6) * (mask?.[i] ?? 1),
        );
      }
    }
  }
  return weights;
}

/** Road, river and ramp share one spline pass: an elevation profile painted over a corridor. */
interface ISplineParams {
  readonly width?: number;
  readonly shoulder?: number;
  readonly smooth?: boolean;
  readonly material?: MaterialId;
  readonly depth?: number;
  readonly water?: boolean;
  readonly waterWidth?: number;
  readonly color?: string | number;
  readonly points?: readonly (readonly [number, number, number])[];
  readonly from?: readonly [number, number, number];
  readonly to?: readonly [number, number, number];
}

type SplineLayer = Extract<Layer, { type: "road" | "river" | "ramp" }>;

function applySpline(s: ITerrainState, layer: SplineLayer, mask: Float32Array | null): void {
  const p: ISplineParams = layer.params;
  const river = layer.type === "river";
  const ramp = layer.type === "ramp";
  const source = ramp
    ? [p.from as readonly [number, number, number], p.to as readonly [number, number, number]]
    : (p.points ?? []);
  const points = splinePoints(
    source,
    Math.max(1, (p.width ?? 12) * 0.22),
    !ramp && p.smooth !== false,
  );
  const half = (p.width ?? 12) / 2;
  const shoulder = p.shoulder ?? half;
  const extent = half + shoulder;
  const n = s.resolution;
  const cell = s.size / (n - 1);
  const dist = new Float32Array(n * n).fill(Number.POSITIVE_INFINITY);
  const target = new Float32Array(n * n);
  const alpha = layer.opacity ?? 1;
  for (let k = 1; k < points.length; k += 1) {
    const a = points[k - 1] as [number, number, number];
    const b = points[k] as [number, number, number];
    const dx = b[0] - a[0];
    const dz = b[2] - a[2];
    const den = dx * dx + dz * dz;
    if (den < 1e-12) continue;
    const xmin = clamp(Math.floor((Math.min(a[0], b[0]) - extent + s.size / 2) / cell), 0, n - 1);
    const xmax = clamp(Math.ceil((Math.max(a[0], b[0]) + extent + s.size / 2) / cell), 0, n - 1);
    const zmin = clamp(Math.floor((Math.min(a[2], b[2]) - extent + s.size / 2) / cell), 0, n - 1);
    const zmax = clamp(Math.ceil((Math.max(a[2], b[2]) + extent + s.size / 2) / cell), 0, n - 1);
    for (let z = zmin; z <= zmax; z += 1) {
      for (let x = xmin; x <= xmax; x += 1) {
        const wx = world(s, x);
        const wz = world(s, z);
        const t = clamp(((wx - a[0]) * dx + (wz - a[2]) * dz) / den);
        const d = Math.hypot(wx - a[0] - t * dx, wz - a[2] - t * dz);
        const i = z * n + x;
        if (d < (dist[i] as number)) {
          dist[i] = d;
          target[i] = lerp(a[1], b[1], t);
        }
      }
    }
  }
  const material = MATERIAL_IDS.indexOf(p.material ?? (river ? "mud" : "road"));
  for (let i = 0; i < s.height.length; i += 1) {
    const d = dist[i] as number;
    if (d > extent) continue;
    const w = (1 - smoothstep(half, extent, d)) * (mask?.[i] ?? 1) * alpha;
    let y = target[i] as number;
    if (river) {
      const bowl = 1 - 0.35 * clamp(d / half) ** 2;
      y = Math.min(s.height[i] as number, y - (p.depth ?? 4) * bowl);
    }
    s.height[i] = lerp(s.height[i] as number, y, w);
    if (material >= 0) paintWeights(s, i, material, w * (river ? 0.85 : 1));
  }
  if (river && p.water !== false)
    s.rivers.push({
      id: layer.id,
      points,
      width: (p.width ?? 12) * (p.waterWidth ?? 0.76),
      color: p.color,
      opacity: alpha,
    });
}

/** Applies one validated layer to the state in place. */
export function applyOperation(s: ITerrainState, layer: Layer): void {
  const { type, params: p } = layer;
  const opacity = layer.opacity ?? 1;
  if (layer.enabled === false || opacity <= 0) return;
  const mask = rasterMask(layer.mask, s);
  const weight = (i: number): number => (mask?.[i] ?? 1) * opacity;
  const n = s.resolution;
  const seed = p.seed ?? s.seed;
  switch (type) {
    case "noise": {
      const amplitude = p.amplitude ?? 35;
      const scale = p.scale ?? 100;
      const warp = p.warp ?? 20;
      for (let z = 0; z < n; z += 1) {
        for (let x = 0; x < n; x += 1) {
          const i = z * n + x;
          const wx = world(s, x);
          const wz = world(s, z);
          const ox = noise2(wx / (scale * 1.7) + 17, wz / (scale * 1.7) - 19, seed + 29) * warp;
          const oz = noise2(wx / (scale * 1.7) - 27, wz / (scale * 1.7) + 12, seed + 31) * warp;
          let value =
            (p.base ?? 0) +
            fbm((wx + ox) / scale, (wz + oz) / scale, {
              seed,
              octaves: p.octaves,
              persistence: p.persistence,
              lacunarity: p.lacunarity,
              mode: p.mode,
            }) *
              amplitude;
          if (p.island) {
            const r = Math.hypot(wx / (s.size * 0.59), wz / (s.size * 0.59));
            value =
              value * (1 - smoothstep(0.45, 1, r)) - (p.coastDepth ?? 15) * smoothstep(0.6, 1, r);
          }
          s.height[i] =
            p.blend === "replace"
              ? lerp(s.height[i] as number, value, weight(i))
              : (s.height[i] as number) + value * weight(i);
        }
      }
      break;
    }
    case "sculpt":
    case "flatten":
    case "smooth":
    case "paint": {
      const weights = brushWeights(s, p, mask, seed);
      const w = (i: number): number => (weights?.[i] ?? 1) * opacity;
      if (type === "sculpt")
        for (let i = 0; i < s.height.length; i += 1)
          s.height[i] = (s.height[i] as number) + (p.strength ?? 5) * w(i);
      if (type === "flatten")
        for (let i = 0; i < s.height.length; i += 1)
          s.height[i] = lerp(
            s.height[i] as number,
            ("height" in p ? p.height : undefined) ?? 0,
            w(i) * clamp(p.strength ?? 1),
          );
      if (type === "paint") {
        const channel = MATERIAL_IDS.indexOf(("material" in p ? p.material : undefined) ?? "dirt");
        for (let i = 0; i < s.height.length; i += 1)
          paintWeights(s, i, channel, w(i) * clamp(p.strength ?? 1));
      }
      if (type === "smooth")
        for (let k = 0; k < (("iterations" in p ? p.iterations : undefined) ?? 3); k += 1) {
          const old = s.height.slice();
          for (let z = 0; z < n; z += 1) {
            for (let x = 0; x < n; x += 1) {
              const i = z * n + x;
              if (w(i) === 0) continue;
              let total = 0;
              let count = 0;
              for (let dz = -1; dz <= 1; dz += 1) {
                for (let dx = -1; dx <= 1; dx += 1) {
                  const xx = x + dx;
                  const zz = z + dz;
                  if (xx >= 0 && xx < n && zz >= 0 && zz < n) {
                    total += old[zz * n + xx] as number;
                    count += 1;
                  }
                }
              }
              s.height[i] = lerp(old[i] as number, total / count, w(i) * clamp(p.strength ?? 0.65));
            }
          }
        }
      break;
    }
    case "stamp":
    case "paste": {
      const at = p.at ?? [0, 0];
      const radius =
        p.radius ??
        (p.size ? (typeof p.size === "number" ? p.size / 2 : p.size.map((v) => v / 2)) : 60);
      const extents: [number, number] = Array.isArray(radius)
        ? [(radius[0] as number) / 1, (radius[1] as number) / 1]
        : [(radius as number) / 1, (radius as number) / 1];
      const rot = ((p.rotation ?? 0) * Math.PI) / 180;
      const c = Math.cos(rot);
      const sn = Math.sin(rot);
      const shape = ("shape" in p ? p.shape : undefined) ?? "mountain";
      for (let z = 0; z < n; z += 1) {
        for (let x = 0; x < n; x += 1) {
          const i = z * n + x;
          const dx = world(s, x) - at[0];
          const dz = world(s, z) - at[1];
          const u = ((dx * c + dz * sn) / extents[0]) * (p.mirrorX ? -1 : 1);
          const v = ((-dx * sn + dz * c) / extents[1]) * (p.mirrorZ ? -1 : 1);
          const d = Math.hypot(u, v);
          let profile: number;
          let w = 1;
          if (p.data) {
            if (Math.abs(u) > 1 || Math.abs(v) > 1) continue;
            const source: IHeightData = p.data;
            profile = sampleGrid(
              source.values,
              source.width,
              source.height,
              u * 0.5 + 0.5,
              v * 0.5 + 0.5,
            );
            w = falloff(Math.max(Math.abs(u), Math.abs(v)), 1, p.falloff ?? 0.12);
          } else {
            if (d >= 1) continue;
            const rough =
              1 +
              (("roughness" in p ? p.roughness : undefined) ?? 0.13) *
                fbm(u * 5, v * 5, { seed, octaves: 3 });
            if (shape === "crater")
              profile =
                (Math.exp(-(((d - 0.67) / 0.14) ** 2)) * 0.48 -
                  Math.exp(-((d / 0.49) ** 4)) * 0.6) *
                (1 - smoothstep(0.85, 1, d));
            else if (shape === "ridge")
              profile =
                Math.max(0, 1 - Math.abs(v)) ** 1.7 *
                (1 - smoothstep(0.35, 1, Math.abs(u))) *
                rough;
            else if (shape === "mesa") profile = (1 - smoothstep(0.5, 1, d)) * rough;
            else if (shape === "valley") profile = -(1 - smoothstep(0, 1, d)) * rough;
            else if (shape === "dune") profile = Math.max(0, 1 - d) ** 1.2 * (1 + 0.25 * u) * rough;
            else profile = Math.max(0, 1 - d) ** 1.65 * rough;
            profile *= ("amplitude" in p ? p.amplitude : undefined) ?? 45;
            w = falloff(d, 1, p.falloff ?? 0);
          }
          const alpha = weight(i) * w;
          const blend = p.blend ?? (type === "paste" ? "replace" : "add");
          const height = profile * (p.scale ?? 1) + (p.offset ?? 0);
          const value =
            blend === "replace"
              ? height
              : blend === "max"
                ? Math.max(s.height[i] as number, height)
                : blend === "min"
                  ? Math.min(s.height[i] as number, height)
                  : (s.height[i] as number) + height;
          s.height[i] = lerp(s.height[i] as number, value, alpha);
        }
      }
      break;
    }
    case "erode": {
      const eroded =
        p.method === "hydraulic"
          ? hydraulic(s.height, n, s.size, {
              seed,
              droplets: p.droplets,
              maxSteps: p.maxSteps,
              inertia: p.inertia,
              capacity: p.capacity,
              erosion: p.erosion,
              deposition: p.deposition,
              evaporation: p.evaporation,
            })
          : thermal(s.height, n, s.size, p);
      let influence = mask;
      if (p.at || p.points) influence = brushWeights(s, p, mask, seed);
      for (let i = 0; i < s.height.length; i += 1)
        s.height[i] = lerp(
          s.height[i] as number,
          eroded[i] as number,
          (influence?.[i] ?? 1) * opacity * (p.strength ?? 1),
        );
      break;
    }
    case "terrace": {
      const step = p.step ?? 8;
      const softness = p.softness ?? 0.18;
      for (let i = 0; i < s.height.length; i += 1) {
        const v = ((s.height[i] as number) - (p.offset ?? 0)) / step;
        const base = Math.floor(v);
        const f = v - base;
        const target =
          (base + smoothstep(0.5 - softness * 0.5, 0.5 + softness * 0.5, f)) * step +
          (p.offset ?? 0);
        s.height[i] = lerp(s.height[i] as number, target, weight(i) * (p.strength ?? 1));
      }
      break;
    }
    case "materials": {
      if (p.reset !== false)
        for (let i = 0; i < s.height.length; i += 1)
          paintWeights(s, i, MATERIAL_IDS.indexOf(p.base ?? "grass"), weight(i));
      for (const rule of p.rules ?? []) {
        const ruleMask = rasterMask(rule.mask, s);
        const channel = MATERIAL_IDS.indexOf(rule.material);
        for (let i = 0; i < s.height.length; i += 1)
          paintWeights(s, i, channel, (ruleMask?.[i] ?? 1) * weight(i) * (rule.strength ?? 1));
      }
      break;
    }
    case "biome": {
      const name = p.name ?? "forest";
      s.biomes[name] ??= new Float32Array(s.height.length);
      const values = s.biomes[name];
      const weights = brushWeights(s, p, mask, seed);
      for (let i = 0; i < values.length; i += 1)
        values[i] = lerp(
          values[i] as number,
          p.value ?? 1,
          (weights?.[i] ?? 1) * opacity * (p.strength ?? 1),
        );
      break;
    }
    case "scatter":
      s.scatterRules.push({ id: layer.id, ...p, mask: layer.mask, opacity, clear: [] });
      break;
    case "clear": {
      if (p.target === "scatter" || p.target === "all")
        for (const rule of s.scatterRules)
          if (!p.asset || rule.asset === p.asset)
            rule.clear.push({ mask: layer.mask ?? { type: "all" }, opacity });
      if (p.target === "biome" || p.target === "all")
        for (const [name, values] of Object.entries(s.biomes)) {
          if (p.name && p.name !== name) continue;
          for (let i = 0; i < values.length; i += 1)
            values[i] = (values[i] as number) * (1 - weight(i));
        }
      if (p.target === "paint" || p.target === "all")
        for (let i = 0; i < s.height.length; i += 1) paintWeights(s, i, 0, weight(i));
      break;
    }
    case "road":
    case "river":
    case "ramp":
      applySpline(s, layer as SplineLayer, mask);
      break;
    case "water":
      s.waterRules.push({ id: layer.id, ...p, mask: layer.mask, opacity });
      break;
    case "heightmap": {
      if (
        p.at !== undefined ||
        p.size !== undefined ||
        p.rotation !== undefined ||
        p.falloff !== undefined
      ) {
        applyOperation(s, {
          ...layer,
          type: "paste",
          params: { ...p, size: p.size ?? s.size, falloff: p.falloff ?? 0 },
        });
        break;
      }
      const data = p.data;
      for (let z = 0; z < n; z += 1) {
        for (let x = 0; x < n; x += 1) {
          const i = z * n + x;
          const value =
            sampleGrid(data.values, data.width, data.height, x / (n - 1), z / (n - 1)) *
              (p.scale ?? 1) +
            (p.offset ?? 0);
          s.height[i] =
            p.blend === "add"
              ? (s.height[i] as number) + value * weight(i)
              : lerp(s.height[i] as number, value, weight(i));
        }
      }
      break;
    }
    default:
      throw Error(`Unsupported operation: ${String((layer as Layer).type)}`);
  }
}

/** The scatter-clear list a deferred rule carries while the stack is still being applied. */
type ScatterClear = IScatterClear;

/**
 * Resolves the deferred passes: water flood fill, then scatter placement sampled against the final
 * heights, materials and biomes so a later height edit cannot leave placements floating.
 */
export function finalizeState(s: ITerrainState): ITerrainState {
  const n = s.resolution;
  const cell = s.size / (n - 1);
  s.waters = [];
  s.instances = [];
  for (const water of s.waterRules) {
    const mask = new Uint8Array(n * n);
    const queue = new Int32Array(n * n);
    const allowed = compileMask(water.mask, s);
    const level = water.level ?? 0;
    const at = water.at ?? [0, 0];
    const radius = water.radius ?? s.size;
    let front = 0;
    let back = 0;
    const eligible = (i: number): boolean => {
      const x = world(s, i % n);
      const z = world(s, Math.floor(i / n));
      return (
        (s.height[i] as number) < level &&
        Math.hypot(x - at[0], z - at[1]) <= radius &&
        allowed(i, x, z) > 0.05
      );
    };
    const push = (i: number): void => {
      if (i >= 0 && i < n * n && !mask[i] && eligible(i)) {
        mask[i] = 1;
        queue[back] = i;
        back += 1;
      }
    };
    if (water.kind === "ocean") {
      for (let k = 0; k < n; k += 1) {
        push(k);
        push((n - 1) * n + k);
        push(k * n);
        push(k * n + n - 1);
      }
    } else {
      const x = clamp(Math.round((at[0] + s.size / 2) / cell), 0, n - 1);
      const z = clamp(Math.round((at[1] + s.size / 2) / cell), 0, n - 1);
      push(z * n + x);
    }
    while (front < back) {
      const i = queue[front] as number;
      front += 1;
      const x = i % n;
      const z = Math.floor(i / n);
      if (x > 0) push(i - 1);
      if (x < n - 1) push(i + 1);
      if (z > 0) push(i - n);
      if (z < n - 1) push(i + n);
    }
    s.waters.push({ ...water, level, mask });
    if (!back)
      s.diagnostics.push(
        `Water '${water.id}' has no flooded cells; its seed may be above the water level.`,
      );
  }
  const wet = (i: number, x: number, z: number, h: number): boolean => {
    if (s.waters.some((water) => water.mask[i])) return true;
    for (const river of s.rivers) {
      const half = river.width / 2;
      for (let k = 1; k < river.points.length; k += 1) {
        const a = river.points[k - 1] as readonly [number, number, number];
        const b = river.points[k] as readonly [number, number, number];
        if (
          x < Math.min(a[0], b[0]) - half ||
          x > Math.max(a[0], b[0]) + half ||
          z < Math.min(a[2], b[2]) - half ||
          z > Math.max(a[2], b[2]) + half
        )
          continue;
        const dx = b[0] - a[0];
        const dz = b[2] - a[2];
        const t = clamp(((x - a[0]) * dx + (z - a[2]) * dz) / (dx * dx + dz * dz || 1));
        if (
          Math.hypot(x - a[0] - t * dx, z - a[2] - t * dz) < half &&
          h <= lerp(a[1], b[1], t) + 0.2
        )
          return true;
      }
    }
    return false;
  };
  for (const rule of s.scatterRules) {
    const count = Math.round((rule.count ?? 300) * (rule.opacity ?? 1));
    const seed = (rule.seed ?? s.seed ^ hashString(rule.id)) >>> 0;
    const rnd = random(seed);
    const accept = compileMask(rule.mask, s);
    const clears = rule.clear.map((entry: ScatterClear) => ({
      fn: compileMask(entry.mask, s),
      opacity: entry.opacity,
    }));
    const distance = rule.minDistance ?? 4;
    const gridSize = Math.max(distance, 0.1);
    const buckets = new Map<string, number[]>();
    const accepted: IPlacement[] = [];
    const maxAttempts = count * 40;
    const scale = rule.scale ?? [0.8, 1.3];
    for (let attempt = 0; attempt < maxAttempts && accepted.length < count; attempt += 1) {
      const x = (rnd() - 0.5) * s.size;
      const z = (rnd() - 0.5) * s.size;
      // Every candidate consumes the same draws, including candidates rejected below.
      // Otherwise a mask edit changes later coordinates, scale/yaw and saved identities.
      const acceptance = rnd();
      const scaleRandom = rnd();
      const yaw = rnd() * Math.PI * 2;
      const ix = clamp(Math.round((x / s.size + 0.5) * (n - 1)), 0, n - 1);
      const iz = clamp(Math.round((z / s.size + 0.5) * (n - 1)), 0, n - 1);
      const i = iz * n + ix;
      let w = accept(i, x, z);
      for (const clear of clears) w *= 1 - clear.fn(i, x, z) * clear.opacity;
      if (acceptance > w) continue;
      const h = sampleHeight(s, x, z);
      if (rule.avoidWater !== false && wet(i, x, z, h)) continue;
      if (h < (rule.minHeight ?? -1e9) || h > (rule.maxHeight ?? 1e9)) continue;
      const g = gradientAt(s, x, z);
      const slope = Math.atan(Math.hypot(g[0], g[1])) * (180 / Math.PI);
      if (slope < (rule.minSlope ?? 0) || slope > (rule.maxSlope ?? 90)) continue;
      const gx = Math.floor(x / gridSize);
      const gz = Math.floor(z / gridSize);
      let blocked = false;
      if (distance > 0)
        for (let dz = -1; dz <= 1 && !blocked; dz += 1) {
          for (let dx = -1; dx <= 1 && !blocked; dx += 1) {
            for (const j of buckets.get(`${gx + dx},${gz + dz}`) ?? []) {
              const other = accepted[j] as IPlacement;
              if (
                Math.hypot((other.position[0] as number) - x, (other.position[2] as number) - z) <
                distance
              ) {
                blocked = true;
                break;
              }
            }
          }
        }
      if (blocked) continue;
      const index = accepted.length;
      const itemScale = Array.isArray(scale)
        ? lerp(scale[0] as number, scale[1] as number, scaleRandom)
        : (scale as number);
      const normal: [number, number, number] = [-g[0], 1, -g[1]];
      const length = Math.hypot(normal[0], normal[1], normal[2]);
      accepted.push({
        id: `${rule.id}:candidate:${seed}:${attempt}`,
        layer: rule.id,
        asset: rule.asset ?? "pine",
        position: [x, h + (rule.offsetY ?? 0), z],
        rotation: yaw,
        scale: itemScale,
        normal: [normal[0] / length, normal[1] / length, normal[2] / length],
        alignToNormal: rule.alignToNormal ?? false,
      });
      const key = `${gx},${gz}`;
      const bucket = buckets.get(key) ?? [];
      bucket.push(index);
      buckets.set(key, bucket);
    }
    s.instances.push(...accepted);
    if (accepted.length < count)
      s.diagnostics.push(
        `Scatter '${rule.id}': placed ${accepted.length}/${count}; masks or spacing exhausted the attempt budget.`,
      );
  }
  return s;
}
