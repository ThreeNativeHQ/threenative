export type RunStatus = "RUNNING" | "CRASHED";

export type GameState = {
  /** Set from the UI's pause and resume intents, and read back by the menu. */
  paused: boolean;
  /** True once the UI layer has rendered and published its interactive rectangles. */
  uiReady: boolean;
  /** Metres travelled down the track. The score. */
  distance: number;
  /** Chunks built so far. Proof the track is streaming rather than one long mesh. */
  chunks: number;
  /** Obstacles cleared by less than a lane width. Each one shakes the camera. */
  nearMisses: number;
  /** Which of the three lanes the runner is in: 0, 1, 2. */
  lane: number;
  speed: number;
  status: RunStatus;
};

export const INITIAL_STATE: GameState = {
  paused: false,
  uiReady: false,
  distance: 0,
  chunks: 0,
  nearMisses: 0,
  lane: 1,
  speed: 0,
  status: "RUNNING",
};
