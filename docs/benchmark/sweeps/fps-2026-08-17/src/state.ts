export type GameState = {
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
};
