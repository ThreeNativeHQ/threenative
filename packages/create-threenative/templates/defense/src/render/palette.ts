import { MeshStandardMaterial } from "three";

export const palette = {
  skyHigh: 0x0b2236,
  skyLow: 0x2b6a76,
  ground: 0x173a3b,
  route: 0x4b5660,
  accent: 0xf5c451,
  shadow: 0x07131d,
} as const;

const materials = new Map<string, MeshStandardMaterial>();

export function toon(color: number, roughness = 0.8): MeshStandardMaterial {
  const key = `${color}:${roughness}`;
  const cached = materials.get(key);
  if (cached !== undefined) return cached;
  const material = new MeshStandardMaterial({ color, roughness, metalness: 0.08 });
  materials.set(key, material);
  return material;
}
