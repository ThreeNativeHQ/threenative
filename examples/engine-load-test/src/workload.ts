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

export type RenderMode = "L1" | "L2";

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
