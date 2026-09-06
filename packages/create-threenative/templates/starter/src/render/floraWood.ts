// Generated for you: one merged wood geometry per flora stand. Each branch
// segment is a 5-sided tapered frustum; rings share vertices, so the mesh is
// closed by construction and costs one draw call for the whole stand.
import { BufferAttribute, BufferGeometry } from "three";
import type { IFloraStandSample } from "./floraSample.js";

/**
 * Count boundary edges (edges used by exactly one triangle) from the final
 * attached index array. Closed tubes stitched ring-to-ring report the open
 * ring ends honestly — callers must not label this zero without reading it.
 */

const RADIAL_SEGMENTS = 5;

export function buildWoodGeometry(sample: IFloraStandSample): BufferGeometry {
  const rings = 2;
  const vertsPerSegment = RADIAL_SEGMENTS * rings;
  const positions = new Float32Array(sample.segments.length * vertsPerSegment * 3);
  const normals = new Float32Array(sample.segments.length * vertsPerSegment * 3);
  const indices = new Uint32Array(sample.segments.length * RADIAL_SEGMENTS * 2 * 3);
  let v = 0;
  let index = 0;
  for (const segment of sample.segments) {
    const base = v / 3;
    v = emitTube(segment, positions, normals, v);
    index = emitTubeIndex(indices, index, base);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(normals, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function emitTube(
  segment: {
    readonly tipRadius: number;
    readonly tipX: number;
    readonly tipY: number;
    readonly tipZ: number;
    readonly radius: number;
    readonly x: number;
    readonly y: number;
    readonly z: number;
  },
  positions: Float32Array,
  normals: Float32Array,
  v: number,
): number {
  const dx = segment.tipX - segment.x;
  const dy = segment.tipY - segment.y;
  const dz = segment.tipZ - segment.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  // Stable perpendicular: near-vertical segments (the common trunk case)
  // use the X axis as reference, others use the XZ projection.
  const vertical = Math.abs(dy) / length > 0.9;
  let ux = vertical ? 1 : -dz / length;
  let uz = vertical ? 0 : dx / length;
  const ulen = Math.hypot(ux, uz) || 1;
  ux /= ulen;
  uz /= ulen;
  const upX = (-dy * ux) / length;
  const upY = (dx * ux + dz * uz) / length;
  const upZ = (-dy * uz) / length;
  let cursor = v;
  for (let ring = 0; ring < 2; ring += 1) {
    const t = ring;
    const cx = segment.x + dx * t;
    const cy = segment.y + dy * t;
    const cz = segment.z + dz * t;
    const radius = segment.radius + (segment.tipRadius - segment.radius) * t;
    for (let side = 0; side < RADIAL_SEGMENTS; side += 1) {
      const angle = (side / RADIAL_SEGMENTS) * Math.PI * 2;
      const nx = Math.cos(angle);
      const ny = Math.sin(angle);
      positions[cursor] = cx + (ux * nx + upX * ny) * radius;
      positions[cursor + 1] = cy + upY * ny * radius;
      positions[cursor + 2] = cz + (uz * nx + upZ * ny) * radius;
      const normalLength = Math.hypot(ux * nx + upX * ny, upY * ny, uz * nx + upZ * ny) || 1;
      normals[cursor] = (ux * nx + upX * ny) / normalLength;
      normals[cursor + 1] = (upY * ny) / normalLength;
      normals[cursor + 2] = (uz * nx + upZ * ny) / normalLength;
      cursor += 3;
    }
  }
  return cursor;
}

function emitTubeIndex(indices: Uint32Array, index: number, base: number): number {
  let cursor = index;
  for (let side = 0; side < RADIAL_SEGMENTS; side += 1) {
    const next = (side + 1) % RADIAL_SEGMENTS;
    const a = base + side;
    const b = base + next;
    const c = base + RADIAL_SEGMENTS + side;
    const d = base + RADIAL_SEGMENTS + next;
    indices[cursor] = a;
    indices[cursor + 1] = c;
    indices[cursor + 2] = b;
    indices[cursor + 3] = b;
    indices[cursor + 4] = c;
    indices[cursor + 5] = d;
    cursor += 6;
  }
  return cursor;
}

export function auditWoodTopology(indices: Uint32Array | number[]): {
  boundaryEdges: number;
  degenerateTriangles: number;
} {
  const edgeUse = new Map<number, number>();
  // Key ordered vertex pairs into one number without string allocation.
  const key = (a: number, b: number): number => (a < b ? a * 1_000_000 + b : b * 1_000_000 + a);
  let degenerateTriangles = 0;
  for (let face = 0; face + 2 < indices.length; face += 3) {
    const a = indices[face] as number;
    const b = indices[face + 1] as number;
    const c = indices[face + 2] as number;
    if (a === b || b === c || a === c) {
      degenerateTriangles += 1;
      continue;
    }
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const k = key(u, v);
      edgeUse.set(k, (edgeUse.get(k) ?? 0) + 1);
    }
  }
  let boundaryEdges = 0;
  for (const uses of edgeUse.values()) if (uses === 1) boundaryEdges += 1;
  return { boundaryEdges, degenerateTriangles };
}
