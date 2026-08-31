export type GameState = {
  buoysRounded: number;
  elapsed: number;
  paused: boolean;
  submergedFraction: number;
  status: "sailing" | "won" | "lost";
  uiReady: boolean;
  wind: number;
  shipZ: number;
};
