// Generated for you. Keep the six palette roles coherent when you change the look.
export const palette = {
  skyHigh: 0x8fd5cf,
  skyLow: 0x28556a,
  floor: 0xe6c58d,
  player: 0xfff0b0,
  crate: 0xd86f55,
  accent: 0xf6a05d,
  flower: 0xf47c88,
  grass: 0x67c878,
  grassDark: 0x257254,
  rock: 0x55717b,
  sand: 0xe6c58d,
  shoreline: 0xffdda1,
  waterDeep: 0x1c687c,
  waterFoam: 0xc2f2d6,
  waterLight: 0x8adfc9,
  waterMid: 0x2a8490,
} as const;

export const COAST_WAVES = [
  { amplitude: 0.12, direction: [1, 0.2] as const, speed: 0.52, wavelength: 7.2 },
  { amplitude: 0.055, detail: true, direction: [-0.35, 1] as const, speed: 0.3, wavelength: 3.3 },
] as const;

export const COAST_DOMAIN_WARP = [
  { amplitude: 0.12, direction: [0.65, -0.35] as const, speed: 0.18, wavelength: 11 },
] as const;
