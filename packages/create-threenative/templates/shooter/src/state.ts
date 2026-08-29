export type GamePhase = "playing" | "dead" | "won" | "lost";

export type GameState = {
  /** Set from the UI\'s pause and resume intents, and read back by the menu. */
  paused: boolean;
  /** True once the UI layer has rendered and published its interactive rectangles. */
  uiReady: boolean;
  aimedShots: number;
  aiming: number;
  armor: number;
  cameraShakes: number;
  deaths: number;
  demoDamage: number;
  demoTargetAlive: number;
  friendlyPassed: number;
  gameOver: number;
  gameWon: number;
  health: number;
  hitDistanceTenths: number;
  hitNormalXPercent: number;
  hitNormalYPercent: number;
  hitNormalZPercent: number;
  lives: number;
  pickupFrame: number;
  pickupFrameChanges: number;
  pickups: number;
  radiusInsideDeaths: number;
  radiusMidAlive: number;
  radiusNearAlive: number;
  radiusOutsideAlive: number;
  respawns: number;
  scanCount: number;
  score: number;
  shotsFired: number;
  targetsRemaining: number;
  wave: number;
  wavesCleared: number;
  wallBlocked: number;
  yawDegrees: number;
  phase: GamePhase;
};
