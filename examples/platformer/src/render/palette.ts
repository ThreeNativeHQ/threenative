// Yours: ordinary Three.js data. ThreeNative does not read this file.
//
// One place for every colour in the game. Sampled off the reference frame, then
// nudged toward saturation — a sunny toy world reads as washed out the moment
// you use "realistic" grass and stone values.

export const palette = {
  skyHigh: 0x0a55c6,
  skyLow: 0x7fcdf2,
  cloud: 0xffffff,
  sun: 0xfff3d2,

  grass: 0x54b731,
  grassDark: 0x2f7a1f,
  grassLit: 0x74d045,

  rock: 0x8d7c66,
  rockDark: 0x655847,
  rockLit: 0xa4917a,

  plank: 0xc98a4b,
  plankDark: 0x9c6432,
  rope: 0xd9b98a,

  water: 0x7ddaf0,
  foam: 0xe8fbff,

  fur: 0xf1932c,
  furLight: 0xffd9a1,
  cream: 0xfff0d6,
  jacket: 0x2f7fd6,
  jacketDark: 0x1f5ea6,
  pack: 0x4a6fa5,
  nose: 0x2b2118,

  coin: 0xffc93c,
  coinRim: 0xff9f1c,
  gem: 0x39b7f0,
  gemLit: 0xa8ecff,

  capRed: 0xe2453a,
  roof: 0xc9483c,
  capSpot: 0xfff2e0,
  stem: 0xf3e3c8,
  shell: 0xb5342a,
  shellLit: 0xe2705f,
  slime: 0x9fbf6a,
  eye: 0x2b2118,

  crate: 0xe8912f,
  crateDark: 0xb4651f,
  crateBolt: 0xf7d08a,

  leaf: 0x379331,
  leafDark: 0x256b22,
  trunk: 0x8a5a34,
  flower: 0xff7ea8,
} as const;

export type PaletteKey = keyof typeof palette;
