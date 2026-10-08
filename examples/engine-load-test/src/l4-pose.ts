// The pure L4 scene math of PRD-117 section 3.3 (placements, camera orbit, bob, rotation, per-cube
// colour), kept free of every other import so the native-AOT benchmark driver (PRD-533), which Perry
// compiles with its whole module graph, shares it with the browser and V8 arms instead of copying it.
// `workload.ts` re-exports all of it; nothing here changed when it moved.

export const LCG_SEED = 1337;
export const CUBE_SPACING = 2.5;

/**
 * L4's per-cube albedo, `0xRRGGBB`. Red is pinned and the index fills the other two channels, so no
 * two cubes under 2^24 can share a colour, the value is a pure function of the index in either
 * language, and `benchmark/godot-load-test/load_test.gd` ports it as three byte shifts with no
 * colour-space round trip to disagree about. The point is only that each material is unmistakably
 * that cube's own, so neither engine's batching can pair two of them.
 */
export function uniqueMaterialColor(index: number): number {
  return 0xff0000 | (index & 0x00ffff);
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
