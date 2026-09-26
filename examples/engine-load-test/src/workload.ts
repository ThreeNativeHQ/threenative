// The workload spec of PRD-117 §3, implemented once. `benchmark/godot-load-test/load_test.gd`
// is a line-for-line GDScript port of this file; the two are held together by `positionHash`,
// which the scorer's equivalence gate compares before it will publish any comparison.

export const LCG_SEED = 1337;
export const CUBE_SPACING = 2.5;
export const LADDER = [256, 1024, 4096, 16384] as const;
export const FRAMES_PER_RUNG = 600;
export const WARMUP_FRAMES = 120;
export const REPEATS = 3;
export const KNEE_THRESHOLD_MS = 20;

// L3 is not a third way to author the scene — it is L1's authoring, exactly, with the framework's
// collapse pass switched on. The comparison it answers is what each engine does for a game that
// never optimised, which is the question L1 asks and neither engine answers with a knob.
export type RenderMode = "L1" | "L2" | "L3";

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

export interface ICubePlacement {
  x: number;
  y: number;
  z: number;
}

export interface ICameraPose {
  targetX: number;
  targetY: number;
  targetZ: number;
  x: number;
  y: number;
  z: number;
}

// state = (state * 1664525 + 1013904223) mod 2^32 — PRD-117 §3.3, verbatim. The products stay
// under 2^53 so a JavaScript double and a GDScript int agree on every term exactly.
export function createLcg(seed: number = LCG_SEED): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

export function latticeSide(objectCount: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(objectCount)));
}

export function latticeExtent(objectCount: number): number {
  return latticeSide(objectCount) * CUBE_SPACING;
}

export function createPlacements(objectCount: number): ICubePlacement[] {
  const random = createLcg();
  const side = latticeSide(objectCount);
  const half = (side - 1) / 2;
  const placements: ICubePlacement[] = [];
  for (let index = 0; index < objectCount; index += 1) {
    const gridX = index % side;
    const gridZ = Math.floor(index / side);
    const jitterX = random();
    const jitterZ = random();
    const jitterY = random();
    placements.push({
      x: (gridX - half) * CUBE_SPACING + (jitterX - 0.5) * CUBE_SPACING * 0.6,
      y: 0.5 + jitterY * 3,
      z: (gridZ - half) * CUBE_SPACING + (jitterZ - 0.5) * CUBE_SPACING * 0.6,
    });
  }
  return placements;
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

// A pure function of the frame index — never of elapsed time. A slow arm and a fast arm must
// frame byte-identical scenes at frame 317 or the slower one is simply measured on a different
// scene (PRD-117 §3.3).
export function cameraPose(frameIndex: number, objectCount: number): ICameraPose {
  const extent = latticeExtent(objectCount);
  const angle = frameIndex * 0.0045;
  const radius = extent * 0.34;
  return {
    targetX: Math.cos(angle + Math.PI) * extent * 0.12,
    targetY: 1.5,
    targetZ: Math.sin(angle + Math.PI) * extent * 0.12,
    x: Math.cos(angle) * radius,
    y: extent * 0.09 + 4,
    z: Math.sin(angle) * radius,
  };
}

export function cubeRotationX(index: number, frameIndex: number): number {
  return index * 0.011 + frameIndex * 0.013;
}

export function cubeRotationY(index: number, frameIndex: number): number {
  return index * 0.017 + frameIndex * 0.02;
}

export function cubeBobY(index: number, frameIndex: number, baseY: number): number {
  return baseY + Math.sin(frameIndex * 0.05 + index * 0.3) * 0.5;
}

export function percentile(samples: readonly number[], fraction: number): number {
  if (samples.length === 0) throw new Error("TN_BENCH_EMPTY_SERIES");
  const sorted = [...samples].sort((left, right) => left - right);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[rank] as number;
}
