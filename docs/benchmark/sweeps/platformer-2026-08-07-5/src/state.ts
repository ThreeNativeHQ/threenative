export interface GameState extends Record<string, unknown> {
  coins: number;
  collected: number;
  total: number;
  goalReached: boolean;
  status: "playing" | "won";
  paused: boolean;
  respawns: number;
  elapsed: number;
  message: string;
  restartNonce: number;
}

export const initialState: GameState = {
  coins: 0,
  collected: 0,
  total: 6,
  goalReached: false,
  status: "playing",
  paused: false,
  respawns: 0,
  elapsed: 0,
  message: "Collect every sun coin, then reach the flag!",
  restartNonce: 0,
};
