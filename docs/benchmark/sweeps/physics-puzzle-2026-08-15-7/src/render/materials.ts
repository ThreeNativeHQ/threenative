// Generated for you. This is ordinary Three.js — edit or delete it freely.
import { DoubleSide, MeshStandardMaterial } from "three";
import { palette } from "./palette.js";

export type Materials = ReturnType<typeof createMaterials>;

export function createMaterials() {
  const crateFrame = new MeshStandardMaterial({
    color: palette.crateFrame,
    roughness: 0.92,
    metalness: 0,
  });
  return {
    floor: new MeshStandardMaterial({ color: palette.floor, roughness: 0.86, metalness: 0.05 }),
    floorInlay: new MeshStandardMaterial({
      color: palette.floorInlay,
      roughness: 0.7,
      metalness: 0.1,
    }),
    wall: new MeshStandardMaterial({ color: palette.wall, roughness: 0.88, metalness: 0 }),
    wallShade: new MeshStandardMaterial({
      color: palette.wallShade,
      roughness: 0.95,
      metalness: 0,
    }),
    trim: new MeshStandardMaterial({ color: palette.trim, roughness: 0.8, metalness: 0.05 }),
    stone: new MeshStandardMaterial({ color: palette.stone, roughness: 0.9, metalness: 0.05 }),
    crateFrame,
    // Index matches ICrateSpec.tint. Alternating these across the stack is what
    // reads as "a pile of different crates" without a single byte of texture.
    cratePanels: [
      new MeshStandardMaterial({ color: palette.crateAmber, roughness: 0.82, metalness: 0 }),
      new MeshStandardMaterial({ color: palette.crateTeal, roughness: 0.82, metalness: 0 }),
      new MeshStandardMaterial({ color: palette.crateRust, roughness: 0.82, metalness: 0 }),
    ],
    // The walk-through class. Emissive plus transparent is the whole tell: it
    // glows like the destination, so "light means it is not solid" is one rule.
    phantomPanel: new MeshStandardMaterial({
      color: palette.phantom,
      emissive: palette.phantom,
      emissiveIntensity: 0.34,
      metalness: 0,
      opacity: 0.42,
      roughness: 0.25,
      transparent: true,
    }),
    phantomFrame: new MeshStandardMaterial({
      color: palette.phantom,
      emissive: palette.phantom,
      emissiveIntensity: 0.85,
      metalness: 0,
      opacity: 0.9,
      roughness: 0.2,
      transparent: true,
    }),
    // The rings carry the glow; the slab underneath stays a dark cyan floor. Put
    // the emissive on the slab instead and ACES clips the whole pad to white.
    goal: new MeshStandardMaterial({
      color: palette.goal,
      emissive: palette.goal,
      emissiveIntensity: 0.9,
      roughness: 0.3,
      side: DoubleSide,
      toneMapped: true,
    }),
    goalRim: new MeshStandardMaterial({
      color: palette.goalFloor,
      emissive: palette.goal,
      emissiveIntensity: 0.1,
      roughness: 0.55,
    }),
    lantern: new MeshStandardMaterial({
      color: palette.lantern,
      emissive: palette.lantern,
      emissiveIntensity: 1.6,
      roughness: 0.4,
    }),
    player: new MeshStandardMaterial({ color: palette.player, roughness: 0.55, metalness: 0.02 }),
    playerShade: new MeshStandardMaterial({
      color: palette.playerShade,
      roughness: 0.6,
      metalness: 0.02,
    }),
  };
}
