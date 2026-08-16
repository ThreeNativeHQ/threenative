// The look of the vault room: dark slate stone, warm wood, three crate dyes,
// and one cold cyan that only the magic things are allowed to use.
export const palette = {
  skyHigh: 0x0b1220,
  skyLow: 0x05080f,
  floor: 0x2c3548,
  floorSeam: 0x232b3d,
  wall: 0x3c4760,
  wallDark: 0x1e2534,
  wood: 0x7a5334,
  woodDark: 0x4a3421,
  crateAmber: 0xe89b3e,
  crateRust: 0xd85f45,
  crateTeal: 0x33a094,
  brace: 0x8a5f38,
  ghost: 0x3fd2ff,
  goal: 0x35e2ff,
  lantern: 0xffa842,
  player: 0xf2e8d8,
  accent: 0xffc98a,
} as const;

export const crateDyes = [palette.crateAmber, palette.crateRust, palette.crateTeal] as const;
