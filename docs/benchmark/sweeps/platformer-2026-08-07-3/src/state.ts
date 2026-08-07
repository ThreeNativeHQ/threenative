export interface GameState extends Record<string, unknown> {
  collected: number;
  total: number;
  status: "playing" | "won";
  paused: boolean;
  respawns: number;
  elapsed: number;
  message: string;
  restartNonce: number;
}

export const initialState: GameState = {
  collected: 0,
  total: 9,
  status: "playing",
  paused: false,
  respawns: 0,
  elapsed: 0,
  message: "Collect every sun coin, then reach the flag!",
  restartNonce: 0,
};
