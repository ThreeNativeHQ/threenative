import { MeshStandardMaterial } from "three";

/**
 * Six names, one accent.
 *
 * A runner is read at speed, from behind, in a fraction of a second: the only thing that has to
 * be unmistakable is *what will kill you*. So the accent belongs to obstacles and to nothing
 * else, the track is a cool dark ribbon, and the horizon is warm so the direction of travel is
 * legible even when the track is empty.
 */
export const palette = {
  skyHigh: 0x120c22,
  skyLow: 0xd4623a,
  track: 0x2a2740,
  rail: 0x4a4569,
  accent: 0x64f0d0,
  shadow: 0x07060f,
} as const;

const materials = new Map<string, MeshStandardMaterial>();

/** One cached standard material per colour and roughness, so a track of rails is one material. */
export function surface(color: number, roughness = 0.8, metalness = 0.05): MeshStandardMaterial {
  const key = `${color}:${roughness}:${metalness}`;
  const cached = materials.get(key);
  if (cached !== undefined) return cached;
  const material = new MeshStandardMaterial({ color, metalness, roughness });
  materials.set(key, material);
  return material;
}
