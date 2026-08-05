export type GameState = {
  levelX: number;
  playerX: number;
  score: number;
};

export const initialState: GameState = { levelX: -99, playerX: -2, score: 0 };
