import { MeshStandardMaterial } from "three";

/**
 * The room's colours, in one place. Six names, one accent.
 *
 * A contraption room reads by contrast, not by hue: a cool concrete shell, and one warm accent
 * carried by everything the puzzle is *about* — the crates you move and the ring you are aiming
 * for. The ring separates from the crates by being emissive and translucent rather than by being
 * a seventh colour, which is what keeps the frame legible. Change these six numbers and the whole
 * kit follows.
 */
export const palette = {
  skyHigh: 0x101a2c,
  skyLow: 0x35526b,
  floor: 0x232c38,
  wall: 0x39434f,
  accent: 0xd08a3c,
  shadow: 0x080d14,
} as const;

const materials = new Map<string, MeshStandardMaterial>();

/** One cached standard material per colour and roughness, so a room of crates is one material. */
export function surface(color: number, roughness = 0.8, metalness = 0.06): MeshStandardMaterial {
  const key = `${color}:${roughness}:${metalness}`;
  const cached = materials.get(key);
  if (cached !== undefined) return cached;
  const material = new MeshStandardMaterial({ color, metalness, roughness });
  materials.set(key, material);
  return material;
}
