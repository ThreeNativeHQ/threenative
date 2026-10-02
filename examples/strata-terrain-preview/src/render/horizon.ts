import { BufferGeometry, Float32BufferAttribute } from "three";
import { ImprovedNoise } from "three/addons/math/ImprovedNoise.js";
import type { IBakedWorld } from "./terrain.js";

/** Decorative land beyond the collider; the inner ring uses the bake's exact edge vertices. */
export function createHorizonGeometry(data: IBakedWorld): BufferGeometry {
  const segments = data.resolution - 1;
  const perimeter = segments * 4;
  const rings = 192;
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
      const ridge = 1 - Math.abs(noise.noise(nx * 0.0022, 9.2, nz * 0.0022));
      const fineRidge = 1 - Math.abs(noise.noise(nx * 0.005, 2.4, nz * 0.005));
      const massif = Math.max(0, broad + 0.38);
      const hills =
        18 + massif * (120 + ridge ** 2 * 420) + fineRidge ** 2 * Math.min(1, massif * 3) * 36;
      const height = data.waterLevel === null ? hills : data.waterLevel - 28;
      positions.push(x, (data.heights[edge] as number) * (1 - blend) + height * blend, z);
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
