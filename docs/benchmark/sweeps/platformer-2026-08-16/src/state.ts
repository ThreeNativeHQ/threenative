export type GameState = {
  /** Coins picked up this run — the HUD counter and the proof's collectible path. */
  coins: number;
  /** Every coin on the route, so the HUD can show "7 / 20" without guessing. */
  coinsTotal: number;
  coyoteJumps: number;
  entityCount: number;
  goalReached: boolean;
  jumps: number;
  /** Highest point above the spawn line reached this run. */
  peakRise: number;
  playerX: number;
  respawns: number;
  /** Mirrors `coins`; kept so score-shaped scenarios keep meaning something. */
  score: number;
};
