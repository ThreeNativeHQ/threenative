/**
 * Everything the HUD, the playtest runner and a native UI are allowed to read.
 *
 * Only JSON-safe values: the bridge flushes this store at about 10 Hz and a scenario asserts
 * against these paths by name, so a value that is not here does not exist as far as proof is
 * concerned.
 */
export type GameState = {
  /** Solid crates in the vault — the ones the warden cannot walk through. */
  crates: number;
  /** Phase crates — the ones it can. */
  phaseCrates: number;
  /** Dynamic bodies whose linear speed is under the rest threshold this frame. */
  settledCrates: number;
  /** True once every dynamic body has been at rest at the same time, after the opening drop. */
  settled: boolean;
  /** Solid crates displaced more than a quarter metre from where the drop left them. */
  pushedCrates: number;
  /** Metres the furthest-shoved crate has travelled since the vault settled. */
  pushDistance: number;
  /** Ticks the warden asked to move and the solver refused most of it — a body was in the way. */
  blockedTicks: number;
  /** Times the warden's body entered a phase crate's volume without being stopped by it. */
  passThroughs: number;
  /** Contacts the seal area has recorded, warden or crate. */
  sealContacts: number;
  /** What last touched the seal: nothing yet, the warden, or a crate it shoved in. */
  sealedBy: "crate" | "none" | "warden";
  /** Metres walked. */
  odometer: number;
  /** The warden's vertical speed, and whether the solver reports it standing on something. */
  wardenFall: number;
  wardenGrounded: boolean;
  playerX: number;
  playerZ: number;
  /** Set from the UI's pause and resume intents, and read back by the menu. */
  paused: boolean;
  /** The deterministic double-run check: idle until V, then first, second, done. */
  replayPhase: "done" | "first" | "idle" | "second";
  /** True only once both passes ran and their final-state digests were identical. */
  replayMatch: boolean;
  /**
   * Largest absolute difference between the two passes over every body's position and rotation
   * component, in metres and quaternion units. A boolean says the passes disagreed; this says by
   * how much, which is the difference between float noise and two different simulations.
   */
  replayDrift: number;
  /** Fixed-step ticks each replay pass runs. */
  replayTicks: number;
  /**
   * How many bodies the check covered. Published beside the verdict because a determinism claim
   * without a scope is not a claim: this is the rig, not the whole vault.
   */
  replayBodies: number;
  /** The world seed the vault was built from. */
  seed: number;
  /** The run: "playing" until the seal is reached, then "won" and it stays "won". */
  status: "playing" | "won";
  /** True once the UI layer has rendered and published its interactive rectangles. */
  uiReady: boolean;
};
