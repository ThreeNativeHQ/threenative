// Generated for you. Repaint the dungeon by keeping these six roles coherent.
// A torchlit dungeon. `stone` was 0x27303b under a 0x080b12 sky, and the first frame showed a
// black void filling half the picture with a dark tilted floor cutting across it: the walls were
// too low for the camera height, so the shot was mostly the nothing above them.
export const palette = {
  accent: 0xe8b86a,
  hostile: 0xd96572,
  player: 0x71d1c4,
  skyHigh: 0x2c3050,
  skyLow: 0x121728,
  /** Wall and floor masonry. Mid, so a figure standing on it has something to read against. */
  stone: 0x4a5566,
} as const;

// The darker masonry course and the torch flame are shades of these six rather than roles of their
// own; `materials.ts` owns them, next to the surfaces that use them.
