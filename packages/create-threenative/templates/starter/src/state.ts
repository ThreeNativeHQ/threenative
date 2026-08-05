export type GameState = {
  coyoteJumps: number;
  jumps: number;
  levelX: number;
  playerX: number;
  score: number;
};

export const initialState: GameState = {
  coyoteJumps: 0,
  jumps: 0,
  levelX: -99,
  playerX: -2,
  score: 0,
};
