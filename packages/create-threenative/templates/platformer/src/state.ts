export const TERMINAL = {
  playing: 0,
  won: 1,
  lost: 2,
} as const;

export type TerminalState = (typeof TERMINAL)[keyof typeof TERMINAL];

export type GameState = {
  /** Set from the UI\'s pause and resume intents, and read back by the menu. */
  paused: boolean;
  /** True once the UI layer has rendered and published its interactive rectangles. */
  uiReady: boolean;
  checkpoint: number;
  coins: number;
  coyoteJumps: number;
  defeated: number;
  dashes: number;
  hearts: number;
  jumps: number;
  peakRise: number;
  playerX: number;
  grounded: boolean;
  respawns: number;
  terminal: TerminalState;
  topSpeed: number;
};
