export type GameState = {
  coins: number;
  coyoteJumps: number;
  goalReached: boolean;
  jumps: number;
  levelX: number;
  peakRise: number;
  playerX: number;
  respawns: number;
  score: number;
  totalCoins: number;
};

export const initialState: GameState = {
  coins: 0,
  coyoteJumps: 0,
  goalReached: false,
  jumps: 0,
  levelX: -99,
  peakRise: 0,
  playerX: -2,
  respawns: 0,
  score: 0,
  totalCoins: 12,
};
