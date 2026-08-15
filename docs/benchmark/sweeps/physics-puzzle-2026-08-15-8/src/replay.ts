import { Simulation } from "./sim.js";

/** Never replay less than this, so pressing the key at tick 0 still proves the opening drop. */
const MINIMUM_TICKS = 180;
/** Nor more than this, so a long session still resolves inside one frame. */
const MAXIMUM_TICKS = 3600;

export type ReplayPhase = "idle" | "running" | "complete";

export interface IReplayResult {
  readonly hashA: number;
  readonly hashB: number;
  readonly match: boolean;
  readonly ticks: number;
}

/**
 * Runs the recorded input sequence twice against two freshly seeded worlds and reports whether
 * the two runs ended in the same state. The live session is untouched: both runs are their own
 * simulation, so a mismatch is a determinism defect and nothing else.
 */
export function runDeterminismCheck(seed: number, inputLog: readonly number[]): IReplayResult {
  const ticks = Math.min(MAXIMUM_TICKS, Math.max(MINIMUM_TICKS, inputLog.length));
  const hashA = simulateOnce(seed, inputLog, ticks);
  const hashB = simulateOnce(seed, inputLog, ticks);
  return { hashA, hashB, match: hashA === hashB, ticks };
}

function simulateOnce(seed: number, inputLog: readonly number[], ticks: number): number {
  const simulation = new Simulation(seed);
  try {
    for (let index = 0; index < ticks; index += 1) simulation.step(inputLog[index] ?? 0);
    return simulation.fingerprint();
  } finally {
    simulation.dispose();
  }
}
