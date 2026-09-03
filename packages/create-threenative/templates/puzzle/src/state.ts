export type PuzzleStatus = "PLAYING" | "SOLVED";

/** How far the ball may drift below the floor before the run is treated as lost geometry. */
export const FLOOR_FAIL_Y = -6;

export type GameState = {
  /** Set from the UI's pause and resume intents, and read back by the menu. */
  paused: boolean;
  /** True once the UI layer has rendered and published its interactive rectangles. */
  uiReady: boolean;
  /** How many crates the player has picked up and set down again. */
  cratesMoved: number;
  /** Seconds since the room opened. */
  elapsed: number;
  /** True while a crate is held by the pointer or by the grab key. */
  holding: boolean;
  /** How many times the hinged weight has been released. */
  swings: number;
  status: PuzzleStatus;
};

export const INITIAL_STATE: GameState = {
  paused: false,
  uiReady: false,
  cratesMoved: 0,
  elapsed: 0,
  holding: false,
  swings: 0,
  status: "PLAYING",
};
