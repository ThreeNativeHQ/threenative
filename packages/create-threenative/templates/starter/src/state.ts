export type GameState = {
  coyoteJumps: number;
  entityCount: number;
  jumps: number;
  levelX: number;
  lives: number;
  odometer: number;
  peakRise: number;
  playerX: number;
  respawns: number;
  score: number;
  /** The run: "playing" until the flag is reached ("won") or the last life is gone ("lost"). */
  status: "lost" | "playing" | "won";
};
