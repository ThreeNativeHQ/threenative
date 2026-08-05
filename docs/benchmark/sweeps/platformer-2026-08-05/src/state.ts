export type GameState = {
  checkpoint: number;
  coins: number;
  coyoteJumps: number;
  defeated: number;
  dashes: number;
  hearts: number;
  jumps: number;
  peakRise: number;
  respawns: number;
  topSpeed: number;
};

export const initialState: GameState = {
  checkpoint: 0,
  coins: 0,
  coyoteJumps: 0,
  defeated: 0,
  dashes: 0,
  hearts: 3,
  jumps: 0,
  peakRise: 0,
  respawns: 0,
  topSpeed: 0,
};
