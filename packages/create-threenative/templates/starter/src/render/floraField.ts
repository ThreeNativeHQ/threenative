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
  IFloraSegmentSample,
  IFloraStandSample,
} from "./floraSample.js";

export type {
  IFloraBounds, IFloraBudgets, IFloraEnvelope, IFloraLeafSample, IFloraPlantSample,
  IFloraReport, IFloraSegmentSample, IFloraStandSample,
} from "./floraSample.js";

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

function finite(value: number, field: string): number {
  if (!Number.isFinite(value)) throw new Error(`TN_FLORA_ENVELOPE_INVALID: ${field} not finite.`);
  return value;
}

export function validateEnvelope(envelope: IFloraEnvelope): void {
  const light = finite(envelope.light, "light");
  const sunAngle = finite(envelope.sunAngle, "sunAngle");
  const wind = finite(envelope.wind, "wind");
  const aridity = finite(envelope.aridity, "aridity");
  const gravity = finite(envelope.gravity, "gravity");
  if (light < 0 || light > 1) throw new Error("TN_FLORA_ENVELOPE_INVALID: light not in [0,1].");
  if (sunAngle < 0 || sunAngle > 1) throw new Error("TN_FLORA_ENVELOPE_INVALID: sunAngle bad.");
  if (wind < 0 || wind > 1) throw new Error("TN_FLORA_ENVELOPE_INVALID: wind not in [0,1].");
  if (aridity < 0 || aridity > 1) throw new Error("TN_FLORA_ENVELOPE_INVALID: aridity bad.");
  if (gravity < 0.1 || gravity > 3) throw new Error("TN_FLORA_ENVELOPE_INVALID: gravity bad.");
}

export function hashArrays(positions: Float32Array, indices: Uint32Array): {
  positionHash: string;
  indexHash: string;
} {
  const hashBytes = (bytes: Uint8Array): string => {
    let hash = 2_166_136_261;
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 16_777_619);
    return (hash >>> 0).toString(16).padStart(8, "0");
  };
  const positionBytes = new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength);
  const indexBytes = new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength);
  return { indexHash: hashBytes(indexBytes), positionHash: hashBytes(positionBytes) };
}

interface IGrowState {
  readonly droopBase: number;
  readonly canopy: () => number;
  readonly budgets: IFloraBudgets;
  readonly segments: IFloraSegmentSample[];
}

interface IPlantSize {
  readonly baseRadius: number;
  readonly height: number;
  readonly leanX: number;
  readonly leanZ: number;
}

function growBranch(state: IGrowState, plant: number, ox: number, oz: number, size: IPlantSize): void {
  // BFS emission keeps parent < own index; one origin; budget-capped.
  const branchAngle = 0.45 + state.canopy() * 0.3;
  const trunkSegments = 2 + Math.floor(state.canopy() * 2);
  const queue: Array<{ depth: number; parent: number; x: number; y: number; z: number }> = [
    { depth: 0, parent: -1, x: ox, y: 0, z: oz },
  ];
  let direction = state.canopy() * Math.PI * 2;
  let radius = size.baseRadius;
  while (queue.length > 0 && state.segments.length < state.budgets.maxSegments) {
    const node = queue.shift();
    if (node === undefined) break;
    const length = (size.height / (trunkSegments + 2)) * (0.8 + state.canopy() * 0.4);
    const spread = state.canopy() * branchAngle;
    direction += (state.canopy() - 0.5) * 0.6;
    const droop = Math.min(Math.PI / 2, state.droopBase * (1 + node.depth * 0.3));
    const tipX = node.x + Math.sin(direction + spread) * length * 0.5 + size.leanX * length;
    const tipZ = node.z + Math.cos(direction + spread) * length * 0.5 + size.leanZ * length;
    const tipY = node.y + Math.cos(droop) * length;
    const tipRadius = Math.max(0.012, radius * 0.7);
    const index = state.segments.length;
    state.segments.push({
      bend: droop, depth: node.depth, parent: node.parent, plant, radius,
      tipRadius, tipX, tipY, tipZ, x: node.x, y: node.y, z: node.z,
    });
    radius = tipRadius;
    if (node.depth >= 2) continue;
    queue.push({ depth: node.depth + 1, parent: index, x: tipX, y: tipY, z: tipZ });
    if (node.depth === 0 && state.segments.length + queue.length < state.budgets.maxSegments)
      queue.push({ depth: 1, parent: index, x: tipX, y: tipY, z: tipZ });
  }
}

/** Grow a bounded stand from an envelope and integer seed. Samples only. */
export function growFloraStand(
  envelope: IFloraEnvelope,
  seed: number,
  bounds: IFloraBounds,
  budgets: IFloraBudgets,
): IFloraStandSample {
  validateEnvelope(envelope);
  for (const [field, value] of [
    ["maxPlants", budgets.maxPlants],
    ["maxSegments", budgets.maxSegments],
    ["maxLeaves", budgets.maxLeaves],
  ] as const) {
    if (!Number.isInteger(value) || (value as number) <= 0)
      throw new Error(`TN_FLORA_BUDGET_INVALID: ${field} must be a positive integer.`);
  }
  if (!Number.isInteger(seed)) throw new Error("TN_FLORA_SEED_INVALID: seed must be an integer.");
  for (const [field, value] of [
    ["minX", bounds.minX],
    ["maxX", bounds.maxX],
    ["minZ", bounds.minZ],
    ["maxZ", bounds.maxZ],
  ] as const)
    finite(value, field);
  if (bounds.minX >= bounds.maxX || bounds.minZ >= bounds.maxZ)
    throw new Error("TN_FLORA_BOUNDS_INVALID: bounds are empty.");
  const canopy = mulberry32(seed >>> 0);
  const foliage = mulberry32((seed ^ SALT_FOLIAGE) >>> 0);
  // Envelope biases a continuous vector: height from light, girth from
  // gravity+wind+aridity (physics), lean from sun angle. No species table.
  const baseHeight = 1.1 + envelope.light * 1.6;
  const girthPhysics =
    0.09 * envelope.gravity ** (1 / 3) * (1 + (envelope.wind - 0.2) * 0.6) *
    (1 + (envelope.aridity - 0.35) * 0.7);
  const leafScale = (1 + (0.6 - envelope.light) * 0.8) * (1 + (0.35 - envelope.aridity) * 0.7);
  const droopBase = Math.max(0, 0.55 * envelope.gravity ** 0.55 + (envelope.wind - 0.2) * 0.3);
  const plants: IFloraPlantSample[] = [];
  const segments: IFloraSegmentSample[] = [];
  const leaves: IFloraLeafSample[] = [];
  const spanX = bounds.maxX - bounds.minX;
  const spanZ = bounds.maxZ - bounds.minZ;
  const state: IGrowState = { budgets, canopy, droopBase, segments };
  for (let plant = 0; plant < budgets.maxPlants; plant += 1) {
    if (segments.length >= budgets.maxSegments) break;
    const x = bounds.minX + canopy() * spanX;
    const z = bounds.minZ + canopy() * spanZ;
    const height = baseHeight * (0.75 + canopy() * 0.5);
    const baseRadius = Math.max(0.03, girthPhysics * (0.8 + canopy() * 0.4));
    const lean = (0.5 - envelope.sunAngle) * 0.24;
    const leanX = lean + (canopy() - 0.5) * 0.1;
    const leanZ = (canopy() - 0.5) * 0.1;
    plants.push({ baseRadius, height, leanX, leanZ, x, z });
    growBranch(state, plant, x, z, { baseRadius, height, leanX, leanZ });
  }
  if (plants.length === 0 || segments.length === 0)
    throw new Error("TN_FLORA_STAND_EMPTY: envelope and bounds grew no stand.");
  for (let index = 0; index < segments.length; index += 1) {
    if (leaves.length >= budgets.maxLeaves) break;
    const segment = segments[index] as IFloraSegmentSample;
    const extra = segment.depth >= 1 ? 1 : 0;
    const clusters = extra + Math.floor(foliage() * 2);
    for (let cluster = 0; cluster < clusters; cluster += 1) {
      if (leaves.length >= budgets.maxLeaves) break;
      const along = 0.55 + foliage() * 0.45;
      const offset = (foliage() - 0.5) * 0.5;
      const size = Math.max(0.12, 0.42 * leafScale * (0.7 + foliage() * 0.6));
      leaves.push({
        anchor: [
          segment.x + (segment.tipX - segment.x) * along + offset,
          segment.y + (segment.tipY - segment.y) * along + Math.abs(offset) * 0.5,
          segment.z + (segment.tipZ - segment.z) * along - offset,
        ],
        angle: foliage() * Math.PI * 2,
        phase: foliage() * Math.PI * 2,
        segment: index,
        size,
      });
    }
  }
  if (leaves.length === 0) throw new Error("TN_FLORA_STAND_EMPTY: envelope grew no foliage.");
  return { leaves, plants, segments };
}
