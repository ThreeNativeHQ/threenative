// Six roles carry the look: two sky bands, the three surfaces the level is made
// of, and one accent that every collectible and highlight borrows. `tints` is
// the prop shelf — variations mixed from those six so nothing drifts off-key.
export const palette = {
  skyHigh: 0x1c7fdd,
  skyLow: 0x8ecdf5,
  grass: 0x54c22c,
  rock: 0x909aa6,
  wood: 0xa8672c,
  accent: 0xffc62e,
} as const;

export const tints = {
  grassDark: 0x3a8f1c,
  grassLight: 0x7ada45,
  rockDark: 0x69727e,
  dirt: 0x7d5738,
  woodDark: 0x8f5324,
  woodLight: 0xc9853f,
  rope: 0xc9a06a,
  coinCore: 0xffe479,
  leaf: 0x2f8f2a,
  leafLight: 0x54bb3a,
  trunk: 0x8a5a34,
  cloud: 0xffffff,
  fur: 0xf08a2c,
  furLight: 0xffd9a8,
  jacket: 0x2f7fd6,
  capRed: 0xe0392c,
  cream: 0xf7e7c6,
  shell: 0xb5342c,
  snail: 0x8fbf6a,
  petal: 0xff7fa8,
  goal: 0x35e0d0,
} as const;
