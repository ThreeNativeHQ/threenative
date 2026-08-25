export type DefenseStatus = "LOST" | "PLAYING" | "WON";
export const MAX_LEAKS = 20;

export function registerLeak(leaks: number): {
  readonly leaks: number;
  readonly status: DefenseStatus;
} {
  if (!Number.isInteger(leaks) || leaks < 0)
    throw new Error("Leak count must be a nonnegative integer.");
  const next = leaks + 1;
  return { leaks: next, status: next >= MAX_LEAKS ? "LOST" : "PLAYING" };
}

export type GameState = {
  /** Set from the UI\'s pause and resume intents, and read back by the menu. */
  paused: boolean;
  /** True once the UI layer has rendered and published its interactive rectangles. */
  uiReady: boolean;
  balance: number;
  defeated: number;
  income: number;
  leaks: number;
  overlapRejects: number;
  placementRejects: number;
  routeRejects: number;
  scanCount: number;
  scanWindowFrames: number;
  scanWindowScans: number;
  scanWindowValid: boolean;
  shots: number;
  spent: number;
  status: DefenseStatus;
  towers: number;
  wave: number;
};

export const INITIAL_STATE: GameState = {
  paused: false,
  uiReady: false,
  balance: 120,
  defeated: 0,
  income: 0,
  leaks: 0,
  overlapRejects: 0,
  placementRejects: 0,
  routeRejects: 0,
  scanCount: 0,
  scanWindowFrames: 0,
  scanWindowScans: 0,
  scanWindowValid: false,
  shots: 0,
  spent: 0,
  status: "PLAYING",
  towers: 0,
  wave: 0,
};
