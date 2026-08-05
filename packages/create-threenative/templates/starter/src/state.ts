export type GameState = {
  coyoteJumps: number;
  jumps: number;
  levelX: number;
  peakRise: number;
  playerX: number;
  respawns: number;
  score: number;
};

export const initialState: GameState = {
  coyoteJumps: 0,
  jumps: 0,
  levelX: -99,
  peakRise: 0,
  playerX: -2,
  respawns: 0,
  score: 0,
};
