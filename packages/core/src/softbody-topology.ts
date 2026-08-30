import type { BufferGeometry } from "three";

export interface IClothTopologyOptions {
  /** Original geometry vertex indices that never move. Duplicate positions pin together. */
  readonly pinned: readonly number[];
}

export interface IClothTopology {
  /** Unique local-space xyz values after exact exporter-duplicate welding. */
  readonly positions: Float32Array;
  /** Original geometry vertex index to unique simulation vertex index. */
  readonly originalToUnique: Uint32Array;
  /** Undirected endpoint pairs, one pair per triangle edge. */
  readonly springs: Uint32Array;
  readonly restLengths: Float32Array;
  readonly pinned: Uint32Array;
  readonly neighborCounts: Uint32Array;
  readonly neighbors: Uint32Array;
  readonly neighborRestLengths: Float32Array;
  readonly maxNeighbors: number;
}

export interface IClothReferenceOptions {
  readonly topology: IClothTopology;
  readonly duration: number;
  readonly frameStep: number;
  readonly gravity: readonly [number, number, number];
  readonly wind: readonly [number, number, number];
  readonly stiffness: number;
  readonly damping: number;
}

const REFERENCE_STEP = 1 / 120;

function finite(name: string, value: number): number {
  if (!Number.isFinite(value)) throw new Error(`SoftBody3D ${name} must be finite.`);
  return value;
}

function positive(name: string, value: number): number {
  finite(name, value);
  if (value <= 0) throw new Error(`SoftBody3D ${name} must be greater than zero.`);
  return value;
}

function nonNegative(name: string, value: number): number {
  finite(name, value);
  if (value < 0) throw new Error(`SoftBody3D ${name} must be non-negative.`);
  return value;
}

function valueAt(values: ArrayLike<number>, index: number, label: string): number {
  const value = values[index];
  if (value === undefined) throw new Error(`SoftBody3D ${label} ${index} is missing.`);
  return value;
}

function vertexKey(x: number, y: number, z: number): string {
  return `${x}|${y}|${z}`;
}

function triangleIndices(geometry: BufferGeometry, originalCount: number): Uint32Array {
  const source = geometry.getIndex();
  const count = source?.count ?? originalCount;
  if (count === 0 || count % 3 !== 0)
    throw new Error("SoftBody3D geometry must contain complete triangles.");
  const result = new Uint32Array(count);
  for (let index = 0; index < count; index += 1) {
    const vertex = source === null ? index : source.getX(index);
    if (!Number.isInteger(vertex) || vertex < 0 || vertex >= originalCount)
      throw new Error(`SoftBody3D triangle index ${vertex} is outside the geometry.`);
    result[index] = vertex;
  }
  return result;
}

function restLength(positions: Float32Array, a: number, b: number): number {
  const offsetA = a * 3;
  const offsetB = b * 3;
  const x = valueAt(positions, offsetB, "position") - valueAt(positions, offsetA, "position");
  const y =
    valueAt(positions, offsetB + 1, "position") - valueAt(positions, offsetA + 1, "position");
  const z =
    valueAt(positions, offsetB + 2, "position") - valueAt(positions, offsetA + 2, "position");
  return Math.hypot(x, y, z);
}

function adjacency(
  positions: Float32Array,
  springs: Uint32Array,
): Pick<IClothTopology, "maxNeighbors" | "neighborCounts" | "neighborRestLengths" | "neighbors"> {
  const vertexCount = positions.length / 3;
  const lists = Array.from({ length: vertexCount }, () => [] as { index: number; rest: number }[]);
  for (let spring = 0; spring < springs.length; spring += 2) {
    const a = valueAt(springs, spring, "spring");
    const b = valueAt(springs, spring + 1, "spring");
    const rest = restLength(positions, a, b);
    lists[a]?.push({ index: b, rest });
    lists[b]?.push({ index: a, rest });
  }
  const maxNeighbors = Math.max(1, ...lists.map((list) => list.length));
  const neighborCounts = new Uint32Array(vertexCount);
  const neighbors = new Uint32Array(vertexCount * maxNeighbors);
  const neighborRestLengths = new Float32Array(vertexCount * maxNeighbors);
  for (let vertex = 0; vertex < lists.length; vertex += 1) {
    const list = lists[vertex] as { index: number; rest: number }[];
    neighborCounts[vertex] = list.length;
    for (let neighbor = 0; neighbor < list.length; neighbor += 1) {
      const entry = list[neighbor] as { index: number; rest: number };
      const slot = vertex * maxNeighbors + neighbor;
      neighbors[slot] = entry.index;
      neighborRestLengths[slot] = entry.rest;
    }
  }
  return { maxNeighbors, neighborCounts, neighborRestLengths, neighbors };
}

/** Derive one spring graph from ordinary indexed or non-indexed triangle geometry. */
export function buildClothTopology(
  geometry: BufferGeometry,
  options: IClothTopologyOptions,
): IClothTopology {
  const attribute = geometry.getAttribute("position");
  if (attribute === undefined || attribute.itemSize !== 3 || attribute.count === 0)
    throw new Error("SoftBody3D geometry needs a non-empty vec3 position attribute.");
  if (!Array.isArray(options.pinned) || options.pinned.length === 0)
    throw new Error("SoftBody3D pinned must name at least one original vertex.");

  const originalToUnique = new Uint32Array(attribute.count);
  const uniqueValues: number[] = [];
  const uniqueByPosition = new Map<string, number>();
  for (let original = 0; original < attribute.count; original += 1) {
    const x = finite(`position[${original}].x`, attribute.getX(original));
    const y = finite(`position[${original}].y`, attribute.getY(original));
    const z = finite(`position[${original}].z`, attribute.getZ(original));
    const key = vertexKey(x, y, z);
    let unique = uniqueByPosition.get(key);
    if (unique === undefined) {
      unique = uniqueValues.length / 3;
      uniqueByPosition.set(key, unique);
      uniqueValues.push(x, y, z);
    }
    originalToUnique[original] = unique;
  }
  const positions = new Float32Array(uniqueValues);
  const triangle = triangleIndices(geometry, attribute.count);
  const springKeys = new Set<string>();
  const springValues: number[] = [];
  for (let offset = 0; offset < triangle.length; offset += 3) {
    const vertices = [
      originalToUnique[valueAt(triangle, offset, "triangle")],
      originalToUnique[valueAt(triangle, offset + 1, "triangle")],
      originalToUnique[valueAt(triangle, offset + 2, "triangle")],
    ] as const;
    for (const [left, right] of [
      [vertices[0], vertices[1]],
      [vertices[1], vertices[2]],
      [vertices[2], vertices[0]],
    ] as const) {
      if (left === undefined || right === undefined || left === right) continue;
      const a = Math.min(left, right);
      const b = Math.max(left, right);
      const key = `${a}:${b}`;
      if (springKeys.has(key)) continue;
      springKeys.add(key);
      springValues.push(a, b);
    }
  }
  if (springValues.length === 0) throw new Error("SoftBody3D geometry produced no springs.");
  const springs = new Uint32Array(springValues);
  const restLengths = new Float32Array(springs.length / 2);
  for (let spring = 0; spring < springs.length; spring += 2)
    restLengths[spring / 2] = restLength(
      positions,
      valueAt(springs, spring, "spring"),
      valueAt(springs, spring + 1, "spring"),
    );

  const pinned = new Uint32Array(positions.length / 3);
  for (const original of options.pinned) {
    if (!Number.isInteger(original) || original < 0 || original >= attribute.count)
      throw new Error(`SoftBody3D pinned vertex ${original} is outside the geometry.`);
    const unique = originalToUnique[original];
    if (unique === undefined) throw new Error(`SoftBody3D pinned vertex ${original} is missing.`);
    pinned[unique] = 1;
  }

  return {
    ...adjacency(positions, springs),
    originalToUnique,
    pinned,
    positions,
    restLengths,
    springs,
  };
}

function referenceStep(
  positions: Float64Array,
  velocities: Float64Array,
  options: IClothReferenceOptions,
): void {
  const { topology } = options;
  const forces = new Float64Array(positions.length);
  for (let spring = 0; spring < topology.springs.length; spring += 2) {
    const a = valueAt(topology.springs, spring, "spring");
    const b = valueAt(topology.springs, spring + 1, "spring");
    const ax = a * 3;
    const bx = b * 3;
    const dx = valueAt(positions, bx, "position") - valueAt(positions, ax, "position");
    const dy = valueAt(positions, bx + 1, "position") - valueAt(positions, ax + 1, "position");
    const dz = valueAt(positions, bx + 2, "position") - valueAt(positions, ax + 2, "position");
    const length = Math.hypot(dx, dy, dz);
    if (length <= 1e-9) continue;
    const scale =
      ((length - valueAt(topology.restLengths, spring / 2, "rest length")) * options.stiffness) /
      length;
    for (const [offset, value] of [
      [0, dx * scale],
      [1, dy * scale],
      [2, dz * scale],
    ] as const) {
      forces[ax + offset] = valueAt(forces, ax + offset, "force") + value;
      forces[bx + offset] = valueAt(forces, bx + offset, "force") - value;
    }
  }
  const decay = Math.exp(-options.damping * REFERENCE_STEP);
  for (let vertex = 0; vertex < topology.pinned.length; vertex += 1) {
    if (topology.pinned[vertex] === 1) continue;
    for (let axis = 0; axis < 3; axis += 1) {
      const index = vertex * 3 + axis;
      const acceleration =
        valueAt(forces, index, "force") +
        valueAt(options.gravity, axis, "gravity") +
        valueAt(options.wind, axis, "wind");
      velocities[index] =
        (valueAt(velocities, index, "velocity") + acceleration * REFERENCE_STEP) * decay;
      positions[index] =
        valueAt(positions, index, "position") +
        valueAt(velocities, index, "velocity") * REFERENCE_STEP;
    }
  }
}

/** Scalar oracle for determinism and fixed-substep tests; the runtime solver remains on the GPU. */
export function simulateClothReference(options: IClothReferenceOptions): Float64Array {
  positive("duration", options.duration);
  positive("frameStep", options.frameStep);
  positive("stiffness", options.stiffness);
  nonNegative("damping", options.damping);
  for (const [name, values] of [
    ["gravity", options.gravity],
    ["wind", options.wind],
  ] as const)
    for (const value of values) finite(name, value);
  const frames = Math.round(options.duration / options.frameStep);
  const substeps = Math.round(options.frameStep / REFERENCE_STEP);
  if (
    Math.abs(frames * options.frameStep - options.duration) > 1e-9 ||
    Math.abs(substeps * REFERENCE_STEP - options.frameStep) > 1e-9
  )
    throw new Error("SoftBody3D reference duration and frameStep must align to 1/120 s.");
  const positions = new Float64Array(options.topology.positions);
  const velocities = new Float64Array(positions.length);
  for (let frame = 0; frame < frames; frame += 1)
    for (let substep = 0; substep < substeps; substep += 1)
      referenceStep(positions, velocities, options);
  return positions;
}
