// Yours: ordinary Three.js. ThreeNative does not read this file.
//
// Every material the game uses, built once and shared. Two rules held
// throughout: no textures (CanvasTexture samples black under WebGPURenderer),
// and roughness high enough that nothing reads as plastic. Variety comes from
// alternating palette entries across meshes — see `shades()`.
import { Color, MeshStandardMaterial } from "three";
import { palette } from "./palette.js";

function toy(color: number, roughness = 0.82, metalness = 0): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness, metalness });
}

function glow(color: number, emissive: number, intensity: number): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    emissive: new Color(emissive),
    emissiveIntensity: intensity,
    metalness: 0.35,
    roughness: 0.3,
  });
}

export type Materials = ReturnType<typeof createMaterials>;

export function createMaterials() {
  return {
    grass: toy(palette.grass, 0.92),
    grassLit: toy(palette.grassLit, 0.92),
    grassDark: toy(palette.grassDark, 0.94),
    rock: toy(palette.rock, 0.95),
    rockDark: toy(palette.rockDark, 0.96),
    rockLit: toy(palette.rockLit, 0.94),

    plank: toy(palette.plank, 0.86),
    plankDark: toy(palette.plankDark, 0.88),
    rope: toy(palette.rope, 0.9),

    water: new MeshStandardMaterial({
      color: palette.water,
      emissive: new Color(palette.water),
      emissiveIntensity: 0.6,
      metalness: 0.1,
      opacity: 0.92,
      roughness: 0.12,
      transparent: true,
    }),
    foam: toy(palette.foam, 0.6),

    fur: toy(palette.fur, 0.72),
    furLight: toy(palette.furLight, 0.72),
    cream: toy(palette.cream, 0.7),
    jacket: toy(palette.jacket, 0.68),
    jacketDark: toy(palette.jacketDark, 0.7),
    pack: toy(palette.pack, 0.66),
    nose: toy(palette.nose, 0.5),

    coin: glow(palette.coin, palette.coinRim, 0.55),
    gem: glow(palette.gem, palette.gemLit, 0.8),

    cap: toy(palette.capRed, 0.74),
    roof: toy(palette.roof, 0.86),
    capSpot: toy(palette.capSpot, 0.8),
    stem: toy(palette.stem, 0.86),
    shell: toy(palette.shell, 0.6, 0.15),
    shellLit: toy(palette.shellLit, 0.6, 0.15),
    slime: toy(palette.slime, 0.8),
    eye: toy(palette.eye, 0.35),

    crate: toy(palette.crate, 0.8),
    crateDark: toy(palette.crateDark, 0.84),
    crateBolt: toy(palette.crateBolt, 0.5, 0.3),

    leaf: toy(palette.leaf, 0.9),
    leafDark: toy(palette.leafDark, 0.92),
    trunk: toy(palette.trunk, 0.92),
    flower: toy(palette.flower, 0.85),
    cloud: toy(palette.cloud, 1),
  };
}

/**
 * Pick from a list by index so a run of meshes alternates instead of reading as
 * one flat slab. This is the whole texture strategy — see the note above.
 */
export function shades<T>(list: readonly T[], index: number): T {
  const value = list[((index % list.length) + list.length) % list.length];
  if (value === undefined) throw new Error("shades() needs a non-empty list.");
  return value;
}
