export type GameState = {
  coyoteJumps: number;
  cooldown: number;
  enemiesRemaining: number;
  gameStatus: "active" | "clear";
  health: number;
  maxHealth: number;
  jumps: number;
  levelX: number;
  objective: string;
  peakRise: number;
  playerX: number;
  respawns: number;
  reload: number;
  score: number;
  shots: number;
  targetsRemaining: number;
  collected: number;
};
