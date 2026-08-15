export type GameState = {
  /** Crate-on-goal contacts reported by the goal sensor. */
  contacts: number;
  crates: number;
  goal: boolean;
  phantomPasses: number;
  playerX: number;
  playerZ: number;
  /** Fixed-step checkpoints compared against the previous run. */
  replayChecked: number;
  replayMatch: boolean;
  runs: number;
  settled: number;
  shifted: number;
  restHash: string;
  restMatch: string;
  simHash: string;
  status: string;
  travelled: number;
};
