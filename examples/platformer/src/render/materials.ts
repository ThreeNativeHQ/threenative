// Ordinary Three.js. Everything a screenshot shows lives here, in the game.
// The palette is read off examples/REFERENCE.png: saturated midday colours and
// warm rock.
//
// Colour only, no maps. Cartoon surfaces want low metalness and a high
// roughness so the key light reads as a soft wrap rather than a highlight, and
// surface variety comes from alternating palette entries across a run of
// meshes — the rock strata in `spawn.ts`, the planks in `props.ts`. A
// `CanvasTexture` samples black under `WebGPURenderer`, so the painted-texture
// route is closed here regardless; colour-per-mesh is cheaper and reads closer
// to the reference anyway.
//
// No `flatShading` either: it fights `roundedBox`, which welds its seams
// precisely so normals interpolate across them.
import { MeshStandardMaterial } from "three";

export type Materials = ReturnType<typeof createMaterials>;

export function createMaterials() {
  return {
    block: new MeshStandardMaterial({ color: 0xe79127, roughness: 0.62 }),
    blockTrim: new MeshStandardMaterial({ color: 0xc26e14, roughness: 0.6 }),
    cloud: new MeshStandardMaterial({ color: 0xffffff, fog: false, roughness: 1 }),
    coin: new MeshStandardMaterial({
      color: 0xffc72e,
      emissive: 0x6b4700,
      metalness: 0.5,
      roughness: 0.26,
    }),
    cream: new MeshStandardMaterial({ color: 0xfff3e0, roughness: 0.72 }),
    dark: new MeshStandardMaterial({ color: 0x33241a, roughness: 0.45 }),
    distant: new MeshStandardMaterial({ color: 0x8fb6d8, fog: false, roughness: 1 }),
    flower: new MeshStandardMaterial({ color: 0xf27ba8, roughness: 0.8 }),
    foxCoat: new MeshStandardMaterial({ color: 0x2f8fd8, roughness: 0.62 }),
    foxCoatDark: new MeshStandardMaterial({ color: 0x1f6fae, roughness: 0.6 }),
    foxFur: new MeshStandardMaterial({ color: 0xf59b34, roughness: 0.72 }),
    foxFurDark: new MeshStandardMaterial({ color: 0xd97a1c, roughness: 0.74 }),
    gem: new MeshStandardMaterial({
      color: 0x3fb8f5,
      emissive: 0x0e4f7a,
      metalness: 0.35,
      roughness: 0.14,
    }),
    grass: new MeshStandardMaterial({ color: 0x63c22e, roughness: 0.9 }),
    grassBright: new MeshStandardMaterial({ color: 0x8fdc4c, roughness: 0.88 }),
    grassDark: new MeshStandardMaterial({ color: 0x3f9a1f, roughness: 0.94 }),
    leaf: new MeshStandardMaterial({ color: 0x53b52c, roughness: 0.88 }),
    leafDark: new MeshStandardMaterial({ color: 0x2f8f43, roughness: 0.9 }),
    mushroomCap: new MeshStandardMaterial({ color: 0xe5453c, roughness: 0.62 }),
    pack: new MeshStandardMaterial({ color: 0x2f6fb0, roughness: 0.6 }),
    rock: new MeshStandardMaterial({ color: 0x9d8b73, roughness: 0.95 }),
    rockDark: new MeshStandardMaterial({ color: 0x7b6a57, roughness: 0.96 }),
    rockLight: new MeshStandardMaterial({ color: 0xb9a68b, roughness: 0.94 }),
    rope: new MeshStandardMaterial({ color: 0xd7b384, roughness: 0.95 }),
    shell: new MeshStandardMaterial({ color: 0xb8322c, roughness: 0.42 }),
    snail: new MeshStandardMaterial({ color: 0xa8c86a, roughness: 0.8 }),
    trunk: new MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.95 }),
    water: new MeshStandardMaterial({
      color: 0x7fd6f7,
      emissive: 0x2b8fb5,
      opacity: 0.82,
      roughness: 0.2,
      transparent: true,
    }),
    wood: new MeshStandardMaterial({ color: 0xc08b4a, roughness: 0.85 }),
    woodDark: new MeshStandardMaterial({ color: 0x8c5f30, roughness: 0.88 }),
    woodLight: new MeshStandardMaterial({ color: 0xdaa860, roughness: 0.84 }),
  };
}
