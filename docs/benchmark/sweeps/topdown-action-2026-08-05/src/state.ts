export type GameState = {
  enemiesRemaining: number;
  hits: number;
  objective: string;
  playerX: number;
  playerZ: number;
  reload: number;
  score: number;
  shots: number;
  won: boolean;
};

export const initialState: GameState = {
  enemiesRemaining: 3,
  hits: 0,
  objective: "Clear the arena",
  playerX: 0,
  playerZ: 4,
  reload: 0,
  score: 0,
  shots: 0,
  won: false,
};
