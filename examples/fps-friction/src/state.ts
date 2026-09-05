export interface IRangeState extends Record<string, unknown> {
  /** Solids the last shot's `raycastAll` returned, dressing included. */
  allHits: number;
  /** Shots that resolved to the enemy proxy behind the dressing plate. */
  hits: number;
  /** Camera yaw in radians, driven only by relative pointer motion. */
  lookYaw: number;
  /**
   * Height of a dynamic crate dropped onto the yard. The floor it lands on is a fixed body
   * built from a bare `position` with no carrier `Object3D`; without that body the crate
   * falls forever, so this number is what proves the body exists.
   */
  crateY: number;
  /**
   * `waiting` until the dropped crate overlaps the landing pad, then `landed`. A published
   * primitive so the transition carries a tick, which is what lets a scenario say the state
   * changed *because* of the contact rather than merely after it.
   */
  crateLanding: "landed" | "waiting";
  shots: number;
  timeRemaining: number;
}
