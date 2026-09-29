/** One soldier's dot on the minimap; `id` is that soldier's slot, so React can keep the node. */
export type Blip = { id: number; x: number; z: number; alive: boolean };

export type GameState = {
  aiming: boolean;
  ammo: number;
  distanceMoved: number;
  health: number;
  hitFlash: number;
  /**
   * Red damage vignette, 1 on the frame a round lands and decaying to 0 over about a third of a
   * second. Published as a scalar rather than derived from `health` so "am I being shot" and "am
   * I nearly dead" are two different facts, and the player gets the first one.
   */
  hurtFlash: number;
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
};

/** Shared objective contract for the scene and the HUD. */
export const TARGET_GOAL = 12;
