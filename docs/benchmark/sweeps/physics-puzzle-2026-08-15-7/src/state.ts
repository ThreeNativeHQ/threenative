/** The single store the fixed-step loop writes and React, the HUD and playtests read. */
export type GameState = {
  /** How many dynamic bodies the room spawned this run. */
  bodies: number;
  /** Dynamic bodies Rapier has put to sleep — the "came to rest" readout. */
  settled: number;
  /** Solid bodies the character has been in contact with and shoved. */
  pushes: number;
  /** Bodies currently overlapping the destination sensor. */
  goalContacts: number;
  /** Phantom bodies the character is standing inside right now. */
  phantomOverlaps: number;
  /**
   * How many times the character has entered a phantom body. Monotonic, because
   * an instantaneous count is zero again the moment the character walks out and
   * an observer sampling afterwards would never see the pass-through happen.
   */
  phantomPasses: number;
  /** True once the destination sensor reported a real contact. Never a distance test. */
  solved: boolean;
  /** "player", "crate:<id>" or "" — what actually tripped the destination sensor. */
  solvedBy: string;
  playerX: number;
  playerY: number;
  playerZ: number;
  /** "idle" -> "run1" -> "run2" -> "done". */
  replayPhase: string;
  /** Whether the two fixed-seed, fixed-step runs ended in an identical world. */
  replayMatch: boolean;
  /** Tick index inside the current scripted run. */
  replayTick: number;
  /** Final-world digest of run 1 and run 2. Equal digests are a matching replay. */
  replayHashA: string;
  replayHashB: string;
  /** How many complete two-run checks have finished. */
  replayChecks: number;
  seed: number;
};
