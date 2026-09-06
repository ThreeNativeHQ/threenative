// Generated for you: deterministic flora generation for this game only.
// Plain TypeScript with no three.js import and no browser API.
//
// Draw-order rule (load-bearing): never reorder, add, or remove an RNG draw,
// or every seed's stand changes shape. Adapted from the deterministic norms of
// owenyuwono/dryad (MIT, e85729b): mulberry32 draws in fixed order, topology
// from the seed, thickness from physics — the seed never sets a radius.
import type {
  IFloraBounds,
  IFloraBudgets,
  IFloraEnvelope,
  IFloraLeafSample,
  IFloraPlantSample,
  IFloraReport,
  IFloraSegmentSample,
  IFloraStandSample,
} from "./floraSample.js";

export type {
  IFloraBounds,
  IFloraBudgets,
  IFloraEnvelope,
  IFloraLeafSample,
  IFloraPlantSample,
  IFloraReport,
  IFloraSegmentSample,
  IFloraStandSample,
} from "./floraSample.js";
export {
  validateBounds,
  validateBudgets,
  validateEnvelope,
  validateSeed,
} from "./floraValidate.js";
import { growLeaves } from "./floraFoliage.js";
import { growBranch } from "./floraSkeleton.js";
import {
  validateBounds,
  validateBudgets,
  validateEnvelope,
  validateSeed,
} from "./floraValidate.js";

const SALT_FOLIAGE = 0x1eaf_1eaf;

// Fixed draw order per plant: x, z, height, girth, leanX, leanZ, branchAngle,
// trunkSegments, direction; per segment: length, spread, twist; per leaf:
// density, offset, size, angle, phase — leaves on an isolated substream.
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b_79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function hashArrays(
  positions: Float32Array,
  indices: Uint32Array,
): {
  positionHash: string;
  indexHash: string;
} {
  const hashBytes = (bytes: Uint8Array): string => {
    let hash = 2_166_136_261;
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 16_777_619);
    return (hash >>> 0).toString(16).padStart(8, "0");
  };
  const positionBytes = new Uint8Array(
    positions.buffer,
    positions.byteOffset,
    positions.byteLength,
  );
  const indexBytes = new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength);
  return { indexHash: hashBytes(indexBytes), positionHash: hashBytes(positionBytes) };
}

/** Grow a bounded stand from an envelope and integer seed. Samples only. */
export function growFloraStand(
  envelope: IFloraEnvelope,
  seed: number,
  bounds: IFloraBounds,
  budgets: IFloraBudgets,
): IFloraStandSample {
  validateEnvelope(envelope);
  validateBudgets(budgets);
  validateBounds(bounds);
  validateSeed(seed);
  const canopy = mulberry32(seed >>> 0);
  const foliage = mulberry32((seed ^ SALT_FOLIAGE) >>> 0);
  // Envelope biases a continuous vector: height from light, girth from
  // gravity+wind+aridity (physics), lean from sun angle. No species table.
  const baseHeight = 1.1 + envelope.light * 1.6;
  const girthPhysics =
    0.09 *
    envelope.gravity ** (1 / 3) *
    (1 + (envelope.wind - 0.2) * 0.6) *
    (1 + (envelope.aridity - 0.35) * 0.7);
  const leafScale = (1 + (0.6 - envelope.light) * 0.8) * (1 + (0.35 - envelope.aridity) * 0.7);
  const droopBase = Math.max(0, 0.55 * envelope.gravity ** 0.55 + (envelope.wind - 0.2) * 0.3);
  const plants: IFloraPlantSample[] = [];
  const segments: IFloraSegmentSample[] = [];
  const leaves: IFloraLeafSample[] = [];
  const spanX = bounds.maxX - bounds.minX;
  const spanZ = bounds.maxZ - bounds.minZ;
  const state = { budgets, canopy, droopBase, segments };
  for (let plant = 0; plant < budgets.maxPlants; plant += 1) {
    if (segments.length >= budgets.maxSegments) break;
    const x = bounds.minX + canopy() * spanX;
    const z = bounds.minZ + canopy() * spanZ;
    const height = baseHeight * (0.75 + canopy() * 0.5);
    // Seed never sets thickness: girth is physics only. Individuals vary by
    // height (which is seeded) through the allometric coupling, not by a
    // per-plant radius draw — so no RNG draw is consumed here at all.
    const baseRadius = Math.max(0.03, girthPhysics * (0.72 + height * 0.12));
    const lean = (0.5 - envelope.sunAngle) * 0.24;
    const leanX = lean + (canopy() - 0.5) * 0.1;
    const leanZ = (canopy() - 0.5) * 0.1;
    plants.push({ baseRadius, height, leanX, leanZ, x, z });
    growBranch(state, plant, x, z, { baseRadius, height, leanX, leanZ });
  }
  if (plants.length === 0 || segments.length === 0)
    throw new Error("TN_FLORA_STAND_EMPTY: envelope and bounds grew no stand.");
  growLeaves(foliage, leafScale, segments, leaves, budgets);
  if (leaves.length === 0) throw new Error("TN_FLORA_STAND_EMPTY: envelope grew no foliage.");
  return { leaves, plants, segments };
}
