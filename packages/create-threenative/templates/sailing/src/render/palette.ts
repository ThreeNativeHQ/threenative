// Generated for you. These six roles are the sailing kit's editable visual vocabulary.
export const palette = {
  skyHigh: 0x75c9d8,
  skyLow: 0x061b2b,
  floor: 0x12384a,
  player: 0xffd27a,
  accent: 0x6fe8ff,
  shadow: 0x0b2a3b,
} as const;

/** The kit's readable wave vocabulary; tune the sea here without touching the ship or rules. */
export const SAILING_WAVES = [
  { amplitude: 0.18, direction: [1, 0.18] as const, speed: 0.9, wavelength: 7.5 },
  { amplitude: 0.09, direction: [-0.35, 1] as const, speed: 0.55, wavelength: 3.2, phase: 1.4 },
] as const;

export const SAILING_DOMAIN_WARP = [
  {
    amplitude: 0.18,
    direction: [0.65, -0.35] as const,
    speed: 0.2,
    wavelength: 11,
  },
] as const;
