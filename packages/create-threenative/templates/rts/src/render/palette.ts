// Generated for you. Keep these roles coherent when you change the look.
// A lit grid over rock: one light ground, one dark ground for the slopes a tank cannot climb, and
// the three faction colours the simulation already owns (`STARTS` in src/sim/terrain.ts).
export const palette = {
  /** Buildable ground: the light grid. */
  ground: 0x6f6a55,
  /** Cliffs, ramps and the map edge: the same grid, far darker. */
  cliff: 0x35322b,
  /** The grid line both grounds share, and every route ring's outline. */
  gridLine: 0x24231f,
  /** Ground nobody has ever seen. */
  unseen: 0x0b1a20,
  /** The sky photograph's own horizon, measured from its HDR: distance fades into this. */
  horizon: 0xacb1c1,
  /** The one saturated colour: what the player can touch. */
  accent: 0xffffff,
} as const;
