import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from "three";

export const palette = {
  skyHigh: 0x102d56,
  skyLow: 0x78b8c8,
  road: 0x202936,
  field: 0x173a35,
  accent: 0xffcf4a,
  shadow: 0x07111d,
} as const;

const materials = new Map<string, MeshStandardMaterial>();

export function toon(color: number, roughness = 0.72): MeshStandardMaterial {
  const key = `${color}:${roughness}`;
  const cached = materials.get(key);
  if (cached !== undefined) return cached;
  const material = new MeshStandardMaterial({ color, roughness, metalness: 0.05 });
  materials.set(key, material);
  return material;
}

export function curbBlock(width: number, height: number, depth: number, color: number): Group {
  const group = new Group();
  const mesh = new Mesh(new BoxGeometry(width, height, depth), toon(color, 0.55));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}
