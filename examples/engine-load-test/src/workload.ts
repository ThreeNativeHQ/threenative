// The workload spec of PRD-117 §3, implemented once. `benchmark/godot-load-test/load_test.gd`
// is a line-for-line GDScript port of this file; the two are held together by `positionHash`,
// which the scorer's equivalence gate compares before it will publish any comparison.

import type { ICubePlacement } from "./l4-pose.js";
import { REALISTIC_RUNGS, type RealisticRung } from "./ladder.js";

export {
  LCG_SEED,
  CUBE_SPACING,
  uniqueMaterialColor,
  createLcg,
  latticeSide,
  latticeExtent,
  createPlacements,
  cameraPose,
  cubeRotationX,
  cubeRotationY,
  cubeBobY,
} from "./l4-pose.js";
export type { ICameraPose, ICubePlacement } from "./l4-pose.js";

export const LADDER = [256, 1024, 4096, 16384] as const;
export const FRAMES_PER_RUNG = 600;
export const WARMUP_FRAMES = 120;
export const REPEATS = 3;
export const KNEE_THRESHOLD_MS = 20;

// L3 is not a third way to author the scene — it is L1's authoring, exactly, with the framework's
// collapse pass switched on. The comparison it answers is what each engine does for a game that
// never optimised, which is the question L1 asks and neither engine answers with a knob.
//
// L4 is L3's pipeline on a scene nothing may batch: the same authoring, the same shipped-default
// projection, and one material per cube with an albedo only that cube has, so no engine can fold
// the lattice into instanced draws. It is the fair "what does a per-draw cost?" row (PRD-449 R3).
// L1, L3 and L4 all author one mesh per cube; L2's single InstancedMesh is the only batched rung,
// and L3 and L4 are the only rungs the projection runs over.
// R1-R5 are PRD-464's realistic-scene ladder: L3's authoring with the sun, the local lights, the
// characters, the post chain and the 1080p resolution added on top of the same cube scene. They are
// authored rungs and projected rungs, and the L ladder above them is untouched.
export const RENDER_MODES = ["L1", "L2", "L3", "L4", ...REALISTIC_RUNGS] as const;
export type RenderMode = (typeof RENDER_MODES)[number];

export function isAuthoredRung(mode: RenderMode): boolean {
  return mode !== "L2";
}

export function isProjectedRung(mode: RenderMode): boolean {
  return mode === "L3" || mode === "L4" || isRealisticRung(mode);
}

export function isRealisticRung(mode: RenderMode): mode is RealisticRung {
  return (REALISTIC_RUNGS as readonly string[]).includes(mode);
}

// PRD-400 Phase 1's tuning matrix. Every axis has a default that reproduces the PRD-117 workload
// byte for byte, so `positionHash` and the Godot port stay equivalent until an axis is deliberately
// moved. The matrix sweeps mutation rate 0 / 1% / 10%; the default 1 is the old all-dirty scene.
export type GeometryMode = "shared" | "unique";
export type MaterialMode = "shared" | "unique";

export interface IWorkloadAxes {
  geometry: GeometryMode;
  hierarchyDepth: number;
  material: MaterialMode;
  mutationRate: number;
  passCount: number;
  shadowCasterShare: number;
  visibleFraction: number;
}

export const DEFAULT_AXES: IWorkloadAxes = {
  geometry: "shared",
  hierarchyDepth: 0,
  material: "shared",
  mutationRate: 1,
  passCount: 1,
  shadowCasterShare: 0,
  visibleFraction: 1,
};

// Deterministic object selection: the same release on web and native picks the same subset, so two
// runs of one axis are the same scene. Channel 17 mutates, channel 23 culls.
function axisUnit(index: number, channel: number): number {
  let value = (Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(channel, 0x85ebca6b)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

export function isMutated(index: number, mutationRate: number): boolean {
  if (mutationRate <= 0) return false;
  if (mutationRate >= 1) return true;
  return axisUnit(index, 17) < mutationRate;
}

export function isVisible(index: number, visibleFraction: number): boolean {
  if (visibleFraction >= 1) return true;
  if (visibleFraction <= 0) return false;
  return axisUnit(index, 23) < visibleFraction;
}

// Culled objects are pushed past the far plane rather than hidden with `visible = false`: a hidden
// mesh is free on every engine and would make the axis measure nothing. Far enough that no orbit of
// the camera reaches them at any ladder rung.
export const CULLED_OFFSET_X = 10_000;

export function culledOffsetX(index: number, visibleFraction: number): number {
  return isVisible(index, visibleFraction) ? 0 : CULLED_OFFSET_X;
}

function axisNumber(value: unknown, axis: string): number {
  const parsed = typeof value === "string" && value !== "" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed))
    throw new Error(`TN_BENCH_BAD_AXIS:${axis}`);
  return parsed;
}

function assertAxes(axes: IWorkloadAxes): void {
  if (axes.geometry !== "shared" && axes.geometry !== "unique")
    throw new Error("TN_BENCH_BAD_AXIS:geometry");
  if (axes.material !== "shared" && axes.material !== "unique")
    throw new Error("TN_BENCH_BAD_AXIS:material");
  if (!Number.isInteger(axes.hierarchyDepth) || axes.hierarchyDepth < 0)
    throw new Error("TN_BENCH_BAD_AXIS:hierarchyDepth");
  if (!Number.isInteger(axes.passCount) || axes.passCount < 1)
    throw new Error("TN_BENCH_BAD_AXIS:passCount");
  for (const [axis, fraction] of [
    ["mutationRate", axes.mutationRate],
    ["shadowCasterShare", axes.shadowCasterShare],
    ["visibleFraction", axes.visibleFraction],
  ] as const) {
    if (fraction < 0 || fraction > 1) throw new Error(`TN_BENCH_BAD_AXIS:${axis}`);
  }
}

export function resolveAxes(
  input: Partial<Record<keyof IWorkloadAxes, unknown>> = {},
): IWorkloadAxes {
  const axes: IWorkloadAxes = {
    geometry: (input.geometry ?? DEFAULT_AXES.geometry) as IWorkloadAxes["geometry"],
    hierarchyDepth: axisNumber(
      input.hierarchyDepth ?? DEFAULT_AXES.hierarchyDepth,
      "hierarchyDepth",
    ),
    material: (input.material ?? DEFAULT_AXES.material) as IWorkloadAxes["material"],
    mutationRate: axisNumber(input.mutationRate ?? DEFAULT_AXES.mutationRate, "mutationRate"),
    passCount: axisNumber(input.passCount ?? DEFAULT_AXES.passCount, "passCount"),
    shadowCasterShare: axisNumber(
      input.shadowCasterShare ?? DEFAULT_AXES.shadowCasterShare,
      "shadowCasterShare",
    ),
    visibleFraction: axisNumber(
      input.visibleFraction ?? DEFAULT_AXES.visibleFraction,
      "visibleFraction",
    ),
  };
  assertAxes(axes);
  return axes;
}

/** URL / environment record to resolved axes; the edge parses, `resolveAxes` validates. */
export function parseAxesRecord(record: Record<string, string | undefined>): IWorkloadAxes {
  const text = (value: string | undefined): string | undefined =>
    value === undefined || value === "" ? undefined : value;
  return resolveAxes({
    geometry: text(record.geometry),
    hierarchyDepth: text(record.hierarchyDepth),
    material: text(record.material),
    mutationRate: text(record.mutationRate),
    passCount: text(record.passCount ?? record.passes),
    shadowCasterShare: text(record.shadowCasterShare),
    visibleFraction: text(record.visibleFraction),
  });
}

// L2 is one InstancedMesh: a single geometry, a single material, and one `castShadow` flag for the
// whole batch. A unique geometry or material, or a partial visible fraction or shadow-caster share,
// has no expression in that batch without splitting it into a different experiment, so a nondefault
// L2 cell fails closed at `setRung` rather than quietly measuring the default L2 scene. The 0 and 1
// extremes are whole-batch and stay valid; the default L2 cell is unchanged.
export function assertRungAxesSupported(mode: RenderMode, axes: IWorkloadAxes): void {
  if (mode !== "L2") return;
  const unsupported =
    axes.geometry === "unique" ||
    axes.material === "unique" ||
    axes.visibleFraction < 1 ||
    (axes.shadowCasterShare > 0 && axes.shadowCasterShare < 1);
  if (unsupported) throw new Error("TN_BENCH_UNSUPPORTED_L2_AXES");
}

// Quantised to millimetres before hashing: the two arms agree on the integers even where their
// float printing would not. FNV-1a/32, written the same way in GDScript.
export function positionHash(placements: readonly ICubePlacement[]): string {
  const parts: string[] = [];
  for (const placement of placements.slice(0, 8)) {
    parts.push(
      `${Math.round(placement.x * 1000)},${Math.round(placement.y * 1000)},${Math.round(placement.z * 1000)}`,
    );
  }
  let hash = 2166136261;
  const text = parts.join("|");
  for (let index = 0; index < text.length; index += 1) {
    // 32-bit throughout: the FNV prime times a full 32-bit accumulator exceeds 2^53, so a plain
    // `*` would lose bits in JavaScript and silently disagree with the GDScript port.
    hash = (hash ^ text.charCodeAt(index)) >>> 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Full placement input for SHA-256. Version and count are uint32; every object's x/y/z is
 * float64, all little-endian, in stable object-index order. Negative zero is canonicalized to
 * zero. This covers all placements, but is not the complete mesh/material/camera fixture hash. */
export function canonicalPlacementBytes(
  count: number,
  placementAt: (index: number) => ICubePlacement,
): Uint8Array {
  if (
    !Number.isSafeInteger(count) ||
    count < 0 ||
    count > 0xffffffff ||
    count > (Number.MAX_SAFE_INTEGER - 8) / 24
  )
    throw new Error("TN_BENCH_PLACEMENT_COUNT_OVERFLOW");
  const bytes = new Uint8Array(8 + count * 24);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 1, true);
  view.setUint32(4, count, true);
  let offset = 8;
  for (let index = 0; index < count; index += 1) {
    const placement = placementAt(index);
    for (const value of [placement.x, placement.y, placement.z]) {
      if (!Number.isFinite(value)) throw new Error("TN_BENCH_PLACEMENT_NONFINITE");
      view.setFloat64(offset, Object.is(value, -0) ? 0 : value, true);
      offset += 8;
    }
  }
  return bytes;
}

export function percentile(samples: readonly number[], fraction: number): number {
  if (samples.length === 0) throw new Error("TN_BENCH_EMPTY_SERIES");
  const sorted = [...samples].sort((left, right) => left - right);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[rank] as number;
}
