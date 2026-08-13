export type GamePhase = "playing" | "dead" | "won" | "lost";

export type GameState = {
  armor: number;
  deaths: number;
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
  pickups: number;
  radiusInsideDeaths: number;
  radiusMidAlive: number;
  radiusNearAlive: number;
  radiusOutsideAlive: number;
  respawns: number;
  scanCount: number;
  score: number;
  targetsRemaining: number;
  wave: number;
  wavesCleared: number;
  wallBlocked: number;
  phase: GamePhase;
};
