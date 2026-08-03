export type GameState = {
  coins: number;
  dashReady: boolean;
  elapsed: number;
  gems: number;
  gemsTotal: number;
  hearts: number;
  stars: number;
  status: "clear" | "over" | "play";
};

export const HEARTS = 3;

export const initialState: GameState = {
  coins: 0,
  dashReady: true,
  elapsed: 0,
  gems: 0,
  gemsTotal: 0,
  hearts: HEARTS,
  stars: 0,
  status: "play",
};
