// Crate Vault palette: a dark stone vault lit by warm lantern pools on one side
// and a cold goal glow on the other. Every colour a screenshot shows lives here.
export const palette = {
  skyHigh: 0x0b111c,
  skyLow: 0x05080e,

  floor: 0x2f3a4e,
  floorDark: 0x252f40,
  floorSeam: 0x1b2231,

  stone: 0x2c3448,
  stoneDark: 0x1d2434,
  plaster: 0x8a6038,
  trim: 0x5c4130,
  trimDark: 0x3b2a20,

  crateAmber: 0xefa441,
  crateRust: 0xd35c42,
  crateTeal: 0x4a9086,

  player: 0xf1e9d6,

  lantern: 0xffab52,
  goal: 0x3fe4ff,
  phantom: 0x4fd6ff,
  banner: 0x1f4f7a,
} as const;

/** The three crate colours, in the order the vault deals them out. */
export const crateColors = [palette.crateAmber, palette.crateRust, palette.crateTeal] as const;
