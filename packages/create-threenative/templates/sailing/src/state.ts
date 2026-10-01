export type GameState = {
  buoysRounded: number;
  elapsed: number;
  /** Bearing to the next mark, in radians to starboard of the bow. The HUD arrow points along it. */
  markBearing: number;
  /** Metres to the next mark, over the ground. */
  markDistance: number;
  /** Way on, in metres per second. */
  speed: number;
  paused: boolean;
  submergedFraction: number;
  status: "sailing" | "won" | "lost";
  uiReady: boolean;
  wind: number;
  shipZ: number;
};
