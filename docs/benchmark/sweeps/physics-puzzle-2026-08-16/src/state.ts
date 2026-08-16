export type GameState = {
  /** Dynamic bodies alive in the room, phase crate included. */
  bodyCount: number;
  /** Dynamic bodies whose speed is under the rest threshold this frame. */
  settled: number;
  /** Solid crates the player has actually shoved, counted once each. */
  pushed: number;
  /** Player-vs-solid-crate contacts reported by the simulation. */
  contacts: number;
  /** Times the player has passed through the phase crate. */
  phaseThroughs: number;
  goalReached: boolean;
  /** "" until the goal fires, then "player" or "crate". */
  goalBy: string;
  playerX: number;
  playerZ: number;
  /** Metres the player has travelled, for a movement assertion. */
  distance: number;
  seed: number;
  /** "idle" | "run-a" | "run-b" | "done" */
  replayPhase: string;
  replayHashA: string;
  replayHashB: string;
  /** "unknown" | "match" | "mismatch" */
  replayMatch: string;
  score: number;
  hovered: string;
};
