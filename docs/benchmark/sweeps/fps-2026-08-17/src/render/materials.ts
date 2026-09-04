// Ordinary Three.js. Every surface the reference frame shows lives here.
import {
  DoubleSide,
  type Material,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from "three";
import { palette } from "./palette.js";

export type RangeTextures = {
  readonly surface: Texture;
  readonly targetFace: Texture;
  readonly targetHit: Texture;
};

export type RangeMaterials = {
  readonly floor: Material;
  readonly wall: Material;
  readonly block: Material;
  readonly concrete: Material;
  readonly paint: Material;
  readonly steel: Material;
  readonly targetFace: Material;
  readonly targetHit: Material;
};

/** The tiling surface photo is a 6x6 grid, so one repeat covers six metres. */
const TILE_METRES = 6;

export function tiled(texture: Texture, metres: number): Texture {
  const clone = texture.clone();
  clone.wrapS = RepeatWrapping;
  clone.wrapT = RepeatWrapping;
  clone.colorSpace = SRGBColorSpace;
  clone.repeat.set(metres / TILE_METRES, metres / TILE_METRES);
  clone.anisotropy = 8;
  clone.needsUpdate = true;
  return clone;
}

export function createMaterials(textures: RangeTextures): RangeMaterials {
  const floorMap = tiled(textures.surface, 34);
  textures.targetFace.colorSpace = SRGBColorSpace;
  textures.targetHit.colorSpace = SRGBColorSpace;
  return {
    floor: new MeshStandardMaterial({
      color: palette.floor,
      map: floorMap,
      roughness: 0.92,
      metalness: 0.02,
    }),
    wall: new MeshStandardMaterial({ color: palette.block, roughness: 0.85, metalness: 0.05 }),
    block: new MeshStandardMaterial({ color: 0x121519, roughness: 0.78, metalness: 0.08 }),
    concrete: new MeshStandardMaterial({ color: palette.concrete, roughness: 0.95 }),
    paint: new MeshStandardMaterial({ color: palette.paint, roughness: 0.6 }),
    steel: new MeshStandardMaterial({ color: 0xb9bec3, roughness: 0.4, metalness: 0.7 }),
    // The reference plates read as flat salmon paper at every distance, so the
    // printed face only shows once a plate has been struck and swung down.
    targetFace: new MeshStandardMaterial({
      color: palette.accent,
      emissive: palette.accent,
      emissiveIntensity: 0.06,
      roughness: 0.9,
      side: DoubleSide,
    }),
    targetHit: new MeshStandardMaterial({
      color: 0xff8d7f,
      map: textures.targetHit,
      roughness: 0.9,
      side: DoubleSide,
    }),
  };
}
