export type GameState = {
  collected: number;
  collisions: number;
  coyoteJumps: number;
  distance: number;
  jumps: number;
  levelX: number;
  lane: number;
  phase: "running" | "crashed";
  peakRise: number;
  playerX: number;
  playerZ: number;
  run: number;
  respawns: number;
  score: number;
  speed: number;
};

export const initialState: GameState = {
  collected: 0,
  collisions: 0,
  coyoteJumps: 0,
  distance: 0,
  jumps: 0,
  levelX: -99,
  lane: 1,
  phase: "running",
  peakRise: 0,
  playerX: 0,
  playerZ: 0,
  run: 1,
  respawns: 0,
  score: 0,
  speed: 11,
};
