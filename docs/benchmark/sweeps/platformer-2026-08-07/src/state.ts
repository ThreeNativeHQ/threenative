export type GameStatus = "running" | "won" | "lost";

export interface GameState {
  coins: number;
  totalCoins: number;
  lives: number;
  status: GameStatus;
  message: string;
  time: number;
}

export const initialGameState: GameState = {
  coins: 0,
  totalCoins: 18,
  lives: 3,
  status: "running",
  message: "Collect the coins and reach the flag",
  time: 0,
};
