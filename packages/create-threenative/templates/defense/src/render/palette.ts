import { MeshStandardMaterial } from "three";

// A sector at dusk. `ground` was 0x173a3b against a flat 0x2b6a76 sky, and the first frame showed
// a near-black olive rectangle floating in a teal void — the board had no ground under it, no
// horizon behind it, and no value separation from either.
export const palette = {
  skyHigh: 0x1d3f5e,
  skyLow: 0x86b3b6,
  /** The buildable board. Mid, so a tower standing on it reads against it. */
  ground: 0x3f5f4c,
  route: 0x6b7684,
  accent: 0xf5c451,
  shadow: 0x1a2c38,
} as const;

// Terrain and distant hills are shades of these six rather than roles of their own; `materials.ts`
// owns them, next to the surfaces that use them.

const materials = new Map<string, MeshStandardMaterial>();

export function toon(color: number, roughness = 0.8): MeshStandardMaterial {
  const key = `${color}:${roughness}`;
  const cached = materials.get(key);
  if (cached !== undefined) return cached;
  const material = new MeshStandardMaterial({ color, roughness, metalness: 0.08 });
  materials.set(key, material);
  return material;
}
