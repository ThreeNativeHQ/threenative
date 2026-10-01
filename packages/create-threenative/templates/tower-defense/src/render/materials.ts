// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// Flat-shaded standard materials: a faceted diorama reads as *made* under a low sun, and a flat
// facet catches exactly one light direction, which is what gives every tower a lit side and a
// shadowed side. Roughness stays high and varied so the photographed sky (`sky.ts`) reflects a
// little on metal and not at all on moss.
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  MeshBasicMaterial,
  MeshStandardMaterial,
} from "three";
import type { EnemyKind, TowerKind } from "../balance.js";
import { palette } from "./palette.js";

function flat(
  color: number,
  options: {
    emissive?: number;
    emissiveIntensity?: number;
    metalness?: number;
    roughness?: number;
    twoSided?: boolean;
  } = {},
): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 1,
    flatShading: true,
    metalness: options.metalness ?? 0.12,
    roughness: options.roughness ?? 0.82,
    side: options.twoSided === true ? DoubleSide : undefined,
  });
}

export const slabBaseMaterial = flat(palette.world.slabBase);
export const slabMidMaterial = flat(palette.world.slabMid);
export const slabTopMaterial = flat(palette.world.slabTop, { roughness: 0.95 });
export const tableMaterial = flat(palette.world.table, { metalness: 0, roughness: 1 });
export const roadMaterial = flat(palette.world.road, { roughness: 0.9, twoSided: true });
export const roadInlayMaterial = flat(palette.world.roadInlay, { roughness: 0.7, twoSided: true });
export const roadEdgeMaterial = flat(palette.world.roadEdge, { roughness: 1, twoSided: true });

export const padMaterial = flat(palette.world.pad, { roughness: 0.8 });
/** The "+" on a pad: warm and self-lit, so an empty pad is visible from across the board. */
export const padMarkMaterial = flat(palette.world.padMark, {
  emissive: palette.world.padMark,
  emissiveIntensity: 0.55,
});

export const bodyMaterial = flat(palette.model.body, { metalness: 0.08, roughness: 0.7 });
export const darkMaterial = flat(palette.model.dark, { roughness: 0.75 });
export const metalMaterial = flat(palette.model.metal, { metalness: 0.5, roughness: 0.42 });
export const blackMaterial = flat(palette.model.black, { roughness: 0.9 });

export const pineMaterial = flat(palette.world.pine, { roughness: 1 });
export const pineDarkMaterial = flat(palette.world.pineDark, { roughness: 1 });
export const trunkMaterial = flat(palette.world.trunk, { roughness: 1 });
export const rockMaterial = flat(palette.world.rock, { roughness: 1 });
export const shrubMaterial = flat(palette.world.shrub, { roughness: 1 });

/** The reactor's core: the one cold light on the board, so bloom finds it first. */
export const reactorMaterial = flat(palette.model.reactor, {
  emissive: palette.model.reactorGlow,
  emissiveIntensity: 1.4,
  metalness: 0.2,
  roughness: 0.3,
});

/** A tower's accent: its own colour, lit from inside. */
export function accentMaterial(kind: TowerKind): MeshStandardMaterial {
  const color = palette.towers[kind];
  return flat(color, { emissive: color, emissiveIntensity: 0.45, metalness: 0.2, roughness: 0.5 });
}

/** An enemy's shell, and the eye-glow that says which kind it is. */
export function enemyMaterial(kind: EnemyKind): MeshStandardMaterial {
  const color = palette.enemies[kind];
  return flat(color, {
    emissive: color,
    emissiveIntensity: 0.28,
    metalness: 0.15,
    roughness: 0.55,
  });
}

/**
 * Unlit and additive: beams, rings and sparks. `gain` pushes the colour past 1.0, which is what the
 * bloom stage picks out (its threshold is 1), and `toneMapped: false` keeps the hue from washing out.
 */
export function glowMaterial(color: number, opacity = 1, gain = 2.2): MeshBasicMaterial {
  return new MeshBasicMaterial({
    blending: AdditiveBlending,
    color: new Color(color).multiplyScalar(gain),
    depthWrite: false,
    opacity,
    toneMapped: false,
    transparent: true,
  });
}
