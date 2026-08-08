export type RunStatus = "running" | "crashed";

export type GameState = {
  collectibles: number;
  distance: number;
  jumps: number;
  lane: number;
  obstaclesPassed: number;
  playerX: number;
  playerY: number;
  restartRequested: boolean;
  runs: number;
  score: number;
  sliding: boolean;
  speed: number;
  status: RunStatus;
};
