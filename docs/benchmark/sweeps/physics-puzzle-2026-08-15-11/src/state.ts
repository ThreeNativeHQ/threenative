export type Determinism = "pending" | "match" | "mismatch";
export type Phase = "drop" | "play" | "won";

export type GameState = {
  /** Dynamic bodies in the room. */
  bodies: number;
  /** How many of them are asleep or below the rest threshold. */
  settled: number;
  /** Real contact events between the player and solid crates. */
  contacts: number;
  /** Real overlap events between the player and the pass-through crates. */
  passthroughs: number;
  /** Metres the player has walked; a scripted camera move cannot fake this. */
  distance: number;
  goal: boolean;
  goalBy: string;
  phase: Phase;
  determinism: Determinism;
  settleHash: string;
  baselineHash: string;
  tick: number;
};
