// The workload spec of PRD-117 §3, implemented once. `benchmark/godot-load-test/load_test.gd`
// is a line-for-line GDScript port of this file; the two are held together by `positionHash`,
// which the scorer's equivalence gate compares before it will publish any comparison.
import { sha256 } from "./identity.js";

export const LCG_SEED = 1337;
export const CUBE_SPACING = 2.5;
export const LADDER = [256, 1024, 4096, 16384] as const;
export const FRAMES_PER_RUNG = 600;
export const WARMUP_FRAMES = 120;
export const REPEATS = 3;
export const KNEE_THRESHOLD_MS = 20;

// The fixture's fixed inputs, gathered here so the full-fixture identity hashes the scene that is
// actually built rather than a copy of the numbers: `game.ts` and the update functions below read
// these, and changing a literal in one place without the other is now impossible instead of merely
// unlikely. Flat by design — the canonical encoding is a sorted `name=value` list.
export const CUBE_FIXTURE = {
  antialias: false,
  bobAmplitude: 0.5,
  bobFrameFrequency: 0.05,
  bobIndexPhase: 0.3,
  cameraFar: 4000,
  cameraFov: 60,
  cameraNear: 0.1,
  cameraOrbitAngle: 0.0045,
  cameraOrbitFraction: 0.34,
  cameraTargetFraction: 0.12,
  cameraTargetY: 1.5,
  cameraYFraction: 0.09,
  cameraYOffset: 4,
  cubeSize: 1,
  groundRotationX: -Math.PI / 2,
  groundSize: 200,
  lightColor: 0xffffff,
  lightIntensity: 2.4,
  lightX: 40,
  lightY: 80,
  lightZ: 25,
  materialColor: 0xb8c4cc,
  materialMetalness: 0,
  materialRoughness: 0.75,
  pixelRatio: 1,
  placementBaseY: 0.5,
  placementHeight: 3,
  placementJitter: 0.6,
  rotationXFrame: 0.013,
  rotationXIndex: 0.011,
  rotationYFrame: 0.02,
  rotationYIndex: 0.017,
  viewportHeight: 720,
  viewportWidth: 1280,
} as const;

// L3 is not a third way to author the scene — it is L1's authoring, exactly, with the framework's
// collapse pass switched on. The comparison it answers is what each engine does for a game that
// never optimised, which is the question L1 asks and neither engine answers with a knob.
export type RenderMode = "L1" | "L2" | "L3";

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
  const jitter = CUBE_SPACING * CUBE_FIXTURE.placementJitter;
  for (let index = 0; index < objectCount; index += 1) {
    const gridX = index % side;
    const gridZ = Math.floor(index / side);
    const jitterX = random();
    const jitterZ = random();
    const jitterY = random();
    placements.push({
      x: (gridX - half) * CUBE_SPACING + (jitterX - 0.5) * jitter,
      y: CUBE_FIXTURE.placementBaseY + jitterY * CUBE_FIXTURE.placementHeight,
      z: (gridZ - half) * CUBE_SPACING + (jitterZ - 0.5) * jitter,
    });
  }
  return placements;
}

// The full-fixture identity of PRD-449 §6.1, and the reason it exists: `positionHash` above is a
// deliberate cross-engine agreement kept byte-for-byte as PRD-117 wrote it, and its first-eight
// window means two arms can hash the same eight cubes and disagree about every cube after them. This
// covers the whole fixture instead. It is additive — a report without it still parses, and a report
// carrying it is gated on it — so legacy baselines, the GDScript port and the v1 equivalence gate all
// keep the meaning they had.
//
// Canonical byte representation (`threenative-cube-fixture-v1`), byte for byte:
//
//   1. UTF-8 `threenative-cube-fixture-v1\n`.
//   2. UTF-8 `cubeSpacing=<number>\nlcgSeed=<number>\n`.
//   3. UTF-8 `name=<number>\n` for every `CUBE_FIXTURE` key, ascending by UTF-8 code unit — the
//      order is fixed by sorting rather than by declaration, so adding a parameter cannot silently
//      re-order the block. Numbers are ECMAScript `Number::toString`, which the language specifies
//      exactly (shortest round-trip decimal), so no engine can print a different one.
//   4. `u32` object count, little-endian.
//   5. Per placement, in placement order, `x`, `y`, `z` as IEEE-754 binary64, little-endian, with
//      no quantisation — a sub-micrometre difference is a difference, and the legacy hash's
//      millimetre rounding is a reporting convenience, not the fixture.
//
// Little-endian is stated rather than inherited: `DataView` is the only byte order JS exposes, and
// the format must not depend on the host's native order.
export const FIXTURE_IDENTITY_VERSION = "threenative-cube-fixture-v1";

const fixtureEncoder = new TextEncoder();

export function canonicalCubeFixtureBytes(placements: readonly ICubePlacement[]): Uint8Array {
  const parameters = [
    `cubeSpacing=${CUBE_SPACING}`,
    `lcgSeed=${LCG_SEED}`,
    ...Object.keys(CUBE_FIXTURE)
      .sort()
      .map((key) => `${key}=${String(CUBE_FIXTURE[key as keyof typeof CUBE_FIXTURE])}`),
  ].join("\n");
  const header = fixtureEncoder.encode(`${FIXTURE_IDENTITY_VERSION}\n${parameters}\n`);
  const body = new Uint8Array(4 + placements.length * 24);
  const view = new DataView(body.buffer);
  view.setUint32(0, placements.length, true);
  placements.forEach((placement, index) => {
    const offset = 4 + index * 24;
    view.setFloat64(offset, placement.x, true);
    view.setFloat64(offset + 8, placement.y, true);
    view.setFloat64(offset + 16, placement.z, true);
  });
  const bytes = new Uint8Array(header.byteLength + body.byteLength);
  bytes.set(header, 0);
  bytes.set(body, header.byteLength);
  return bytes;
}

export async function cubeFixtureHash(placements: readonly ICubePlacement[]): Promise<string> {
  return sha256(canonicalCubeFixtureBytes(placements));
}

// Quantised to millimetres before hashing: the two arms agree on the integers even where their
// float printing would not. FNV-1a/32, written the same way in GDScript. The first eight placements
// only, and that window is now a documented limit rather than the whole gate — see the full-fixture
// identity above, which is what a campaign-level comparison actually reads.
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
  const angle = frameIndex * CUBE_FIXTURE.cameraOrbitAngle;
  const radius = extent * CUBE_FIXTURE.cameraOrbitFraction;
  return {
    targetX: Math.cos(angle + Math.PI) * extent * CUBE_FIXTURE.cameraTargetFraction,
    targetY: CUBE_FIXTURE.cameraTargetY,
    targetZ: Math.sin(angle + Math.PI) * extent * CUBE_FIXTURE.cameraTargetFraction,
    x: Math.cos(angle) * radius,
    y: extent * CUBE_FIXTURE.cameraYFraction + CUBE_FIXTURE.cameraYOffset,
    z: Math.sin(angle) * radius,
  };
}

export function cubeRotationX(index: number, frameIndex: number): number {
  return index * CUBE_FIXTURE.rotationXIndex + frameIndex * CUBE_FIXTURE.rotationXFrame;
}

export function cubeRotationY(index: number, frameIndex: number): number {
  return index * CUBE_FIXTURE.rotationYIndex + frameIndex * CUBE_FIXTURE.rotationYFrame;
}

export function cubeBobY(index: number, frameIndex: number, baseY: number): number {
  return (
    baseY +
    Math.sin(frameIndex * CUBE_FIXTURE.bobFrameFrequency + index * CUBE_FIXTURE.bobIndexPhase) *
      CUBE_FIXTURE.bobAmplitude
  );
}

export function percentile(samples: readonly number[], fraction: number): number {
  if (samples.length === 0) throw new Error("TN_BENCH_EMPTY_SERIES");
  const sorted = [...samples].sort((left, right) => left - right);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[rank] as number;
}
