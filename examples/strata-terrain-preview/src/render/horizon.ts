import { Heightfield } from "@threenative/core/world";
import { BufferGeometry, Float32BufferAttribute } from "three";
import { ImprovedNoise } from "three/addons/math/ImprovedNoise.js";
import distant from "../world/horizon.json";
import type { IBakedWorld } from "./terrain.js";

// Installed authoring erosion runs in bake.mjs; scenery queries only this retained buffer.
const continuation = new Heightfield({
  rows: distant.resolution,
  columns: distant.resolution,
  width: distant.size,
  depth: distant.size,
  origin: { x: 0, z: 0 },
  heights: new Float32Array(distant.heights),
});

/** Decorative land beyond the collider; the inner ring uses the bake's exact edge vertices. */
export function createHorizonGeometry(
  data: IBakedWorld,
  landform: "mountain" | "alpine" | "mesa" | "plain" = "mountain",
  field?: Heightfield,
): BufferGeometry {
  const segments = data.resolution - 1;
  const perimeter = segments * 4;
  // Subdivide eroded land; retain the coastal world's original submerged collar.
  const rings =
    data.waterLevel !== null
      ? 192
      : landform === "alpine"
        ? 384
        : landform === "mountain"
          ? 256
          : 192;
  const noise = new ImprovedNoise();
  const starts = [
    [0, 0],
    [segments, 0],
    [segments, segments],
    [0, segments],
  ] as const;
  const directions = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ] as const;
  // Cache a coarse edge profile; high-frequency baked ribs should not extrude for 480 m.
  const edgeHeight = (vertex: number) => {
    const wrapped = (vertex + perimeter) % perimeter;
    const side = Math.floor(wrapped / segments);
    const along = wrapped % segments;
    const [sx, sz] = starts[side] as readonly [number, number];
    const [dx, dz] = directions[side] as readonly [number, number];
    return data.heights[(sz + along * dz) * data.resolution + sx + along * dx] as number;
  };
  const smoothEdge = (sample: (vertex: number) => number) =>
    Array.from({ length: perimeter }, (_, vertex) => {
      let total = 0;
      for (let offset = -16; offset <= 16; offset++)
        total += sample(vertex + offset) * (17 - Math.abs(offset));
      return total / 289;
    });
  const coarseEdge = smoothEdge(edgeHeight);
  const rawEdgeSlope = coarseEdge.map((_, vertex) => {
    const side = Math.floor(vertex / segments);
    const along = vertex % segments;
    const [sx, sz] = starts[side] as readonly [number, number];
    const [dx, dz] = directions[side] as readonly [number, number];
    const x = ((sx + along * dx) / segments - 0.5) * data.size;
    const z = ((sz + along * dz) / segments - 0.5) * data.size;
    const normal = field?.normalAt(x, z);
    return normal ? -(normal.x * x + normal.z * z) / ((normal.y * data.size) / 2) : 0;
  });
  const edgeSlope = smoothEdge(
    (vertex) => rawEdgeSlope[(vertex + perimeter) % perimeter] as number,
  );
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (let ring = 0; ring <= rings; ring++) {
    const distance = (ring / rings) ** 1.65 * 2100;
    const t = Math.min(1, distance / 480);
    const blend = t * t * (3 - 2 * t);
    for (let vertex = 0; vertex < perimeter; vertex++) {
      const side = Math.floor(vertex / segments);
      const along = vertex % segments;
      const [startX, startZ] = starts[side] as readonly [number, number];
      const [stepX, stepZ] = directions[side] as readonly [number, number];
      const column = startX + along * stepX;
      const row = startZ + along * stepZ;
      const edge = row * data.resolution + column;
      const scale = 1 + distance / (data.size / 2);
      const x = (column / segments - 0.5) * data.size * scale;
      const z = (row / segments - 0.5) * data.size * scale;
      // ponytail: static low-resolution scenery; use authored distant meshes for a larger world.
      const warp = noise.noise(x * 0.0018, 7.3, z * 0.0018) * 150;
      const nx = x + warp;
      const nz = z - warp * 0.7;
      const broad = noise.noise(nx * 0.0013, 4.7, nz * 0.0013);
      const fineRidge = 1 - Math.hypot(noise.noise(nx * 0.005, 2.4, nz * 0.005), 0.065);
      const inland =
        landform === "mesa"
          ? 12 + smoothMesa(broad) * 95 + noise.noise(nx * 0.015, 3, nz * 0.015) * 3
          : landform === "plain"
            ? 5 + broad * 24 + fineRidge * 9
            : Math.max(8, continuation.heightAt(x, z));
      const height = data.waterLevel === null ? inland : data.waterLevel - 28;
      // The collider seam is exact. Short baked rills fade into broad shoulders before the massif.
      // A plain continues the measured edge tangent. Exponential edge smoothing alone started
      // a new slope at the seam, stretching its relief into a visible radial shading stripe.
      const detail =
        data.waterLevel !== null
          ? 1
          : landform === "plain"
            ? Math.exp(-((distance / 80) ** 2))
            : Math.exp(-distance / 45);
      // Continue the local tangent at the seam, then its broad profile, not long radial rills.
      const slope =
        (edgeSlope[vertex] as number) +
        ((rawEdgeSlope[vertex] as number) - (edgeSlope[vertex] as number)) *
          Math.exp(-distance / 12);
      const inherited =
        (data.heights[edge] as number) * detail +
        (coarseEdge[vertex] as number) * (1 - detail) +
        (landform === "plain" ? slope * distance * detail : 0);
      positions.push(x, inherited * (1 - blend) + height * blend, z);
      colors.push(
        data.colors[edge * 3] as number,
        data.colors[edge * 3 + 1] as number,
        data.colors[edge * 3 + 2] as number,
      );
      if (ring === rings) continue;
      const a = ring * perimeter + vertex;
      const b = ring * perimeter + ((vertex + 1) % perimeter);
      const c = a + perimeter;
      const d = b + perimeter;
      indices.push(a, b, c, b, d, c);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Broad flat-topped distant mesas, with an eroded shoulder rather than alpine peaks. */
function smoothMesa(value: number): number {
  const t = Math.max(0, Math.min(1, (value + 0.08) / 0.18));
  return t * t * (3 - 2 * t);
}
