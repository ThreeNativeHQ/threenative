// Generated for you. Keep these six palette roles coherent when you change the look.
// The same neutral greys and one saturated blue the arena ships: the track is the light grid,
// everything structural is the dark grid, and the accent marks what will kill you.
// `horizon` is the sky photograph's own horizon, measured from its HDR, so the fog fades into the
// horizon the frame actually shows.
export const palette = {
  /** Light grid: the track surface and the ground it runs over. */
  floor: 0xb4b1ae,
  /** Dark grid: the rails, the runner's fin, anything structural. */
  structure: 0x747578,
  /** The metre line both grids are drawn in. */
  gridLine: 0x3a3a3c,
  /** The one saturated colour, and it belongs to obstacles and nothing else. */
  accent: 0x2a6cf0,
  /** Touch-control highlight. */
  highlight: 0xffffff,
  /** The sky photograph's horizon: distance fades into this. */
  horizon: 0xacb1c1,
} as const;
