import { Heightfield } from "@threenative/core/world";
import { Float32BufferAttribute, Mesh, MeshStandardMaterial } from "three";

export interface IBakedWorld {
  size: number;
  resolution: number;
  heights: number[];
  colors: number[];
  waterLevel: number | null;
}

export function createTerrain(data: IBakedWorld): { field: Heightfield; mesh: Mesh } {
  const field = new Heightfield({
    rows: data.resolution,
    columns: data.resolution,
    width: data.size,
    depth: data.size,
    origin: { x: 0, z: 0 },
    heights: new Float32Array(data.heights),
  });
  const geometry = field.toGeometry();
  if (data.colors.length !== geometry.getAttribute("position").count * 3)
    throw new RangeError("Baked terrain colours do not match the heightfield");
  geometry.setAttribute("color", new Float32BufferAttribute(data.colors, 3));
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  const mesh = new Mesh(geometry, material);
  mesh.name = "authored-terrain";
  mesh.receiveShadow = true;
  return { field, mesh };
}
