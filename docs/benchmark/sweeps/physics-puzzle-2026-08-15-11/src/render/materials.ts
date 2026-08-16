// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
import { Color, MeshStandardMaterial } from "three";
import { palette } from "./palette.js";

export type CrateColor = "amber" | "rust" | "teal";

const CRATE_BASE: Record<CrateColor, number> = {
  amber: palette.crateAmber,
  rust: palette.crateRust,
  teal: palette.crateTeal,
};

function shade(hex: number, factor: number): Color {
  return new Color(hex).multiplyScalar(factor);
}

function crateMaterials(base: number) {
  return {
    // The panel sits a touch darker than the planks so the frame reads as
    // raised timber rather than as paint.
    body: new MeshStandardMaterial({ color: shade(base, 1.04), roughness: 0.94, metalness: 0 }),
    trim: new MeshStandardMaterial({ color: shade(base, 1.0), roughness: 0.9, metalness: 0 }),
  };
}

export function createMaterials() {
  return {
    floor: new MeshStandardMaterial({ color: palette.floorDeep, roughness: 0.9, metalness: 0.04 }),
    floorTile: new MeshStandardMaterial({
      color: palette.floorTile,
      roughness: 0.88,
      metalness: 0.04,
    }),
    wallLower: new MeshStandardMaterial({ color: palette.wallLower, roughness: 0.95 }),
    wallUpper: new MeshStandardMaterial({ color: palette.wallUpper, roughness: 0.95 }),
    trim: new MeshStandardMaterial({ color: palette.trim, roughness: 0.85 }),
    ledge: new MeshStandardMaterial({ color: palette.ledge, roughness: 0.85 }),
    stone: new MeshStandardMaterial({ color: palette.stone, roughness: 0.9 }),
    stoneCap: new MeshStandardMaterial({ color: palette.stoneCap, roughness: 0.9 }),
    banner: new MeshStandardMaterial({ color: palette.banner, roughness: 0.85 }),
    lantern: new MeshStandardMaterial({
      color: palette.lantern,
      emissive: new Color(palette.lantern),
      emissiveIntensity: 1.6,
      roughness: 0.5,
    }),
    lanternCase: new MeshStandardMaterial({ color: 0x3a3a4c, roughness: 0.7, metalness: 0.3 }),
    goal: new MeshStandardMaterial({
      color: palette.goal,
      emissive: new Color(palette.goal),
      emissiveIntensity: 0.7,
      roughness: 0.4,
    }),
    goalStone: new MeshStandardMaterial({ color: 0x6a7a6e, roughness: 0.9 }),
    goalInlay: new MeshStandardMaterial({ color: 0x0d2733, roughness: 0.7 }),
    ghost: new MeshStandardMaterial({
      color: palette.ghost,
      emissive: new Color(palette.ghost),
      emissiveIntensity: 0.22,
      transparent: true,
      opacity: 0.55,
      roughness: 0.25,
    }),
    ghostTrim: new MeshStandardMaterial({
      color: 0x6fd8f7,
      emissive: new Color(palette.ghost),
      emissiveIntensity: 0.3,
      transparent: true,
      opacity: 0.9,
      roughness: 0.25,
    }),
    player: new MeshStandardMaterial({ color: 0xfff3e0, roughness: 0.6, metalness: 0.0 }),
    crate: Object.fromEntries(
      (Object.keys(CRATE_BASE) as CrateColor[]).map((name) => [name, crateMaterials(CRATE_BASE[name])]),
    ) as Record<CrateColor, ReturnType<typeof crateMaterials>>,
  };
}

export type Materials = ReturnType<typeof createMaterials>;
