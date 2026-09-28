export type Blip = { x: number; z: number; alive: boolean };

export type GameState = {
  aiming: boolean;
  ammo: number;
  distanceMoved: number;
  health: number;
  hitFlash: number;
  phase: "playing" | "complete" | "failed";
  reloads: number;
  reserve: number;
  score: number;
  shots: number;
  targetsHit: number;
  timeRemaining: number;
  /** Player ground position and facing, for the minimap. */
  playerX: number;
  playerZ: number;
  playerYaw: number;
  /** Enemy positions for the minimap, one entry per soldier. */
  blips: Blip[];
  /**
   * Boot progress. The town loads ~23 textures and three rigged GLBs totalling
   * about 23 MB, which is a few seconds of black canvas on a cold cache; the
   * HUD shows a real progress bar over it rather than nothing. `ready` flips
   * when the scene has finished building, not when the last byte arrives.
   */
  ready: boolean;
  assetsLoaded: number;
  assetsTotal: number;
};

/** Shared objective contract for the scene and the HUD. */
export const TARGET_GOAL = 12;
