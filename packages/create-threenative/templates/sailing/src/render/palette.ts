// Generated for you. These six roles are the sailing kit's editable visual vocabulary.
// Open water at mid-morning. The values these replace put a pale cyan at the top of the sky dome
// *and* used a near-cyan accent for the wave crests, so sea and sky met at the same value and the
// frame photographed as one flat sheet with no horizon in it. Sea and sky have to disagree.
export const palette = {
  /** Zenith. Properly blue, so the dome has somewhere to fall from. */
  skyHigh: 0x2f6fae,
  /** Horizon haze, and the fog colour. Where sea meets sky, this is the value. */
  skyLow: 0xbcd6df,
  /** Deep water in the troughs. */
  floor: 0x0e3547,
  /** The sun's own colour, used for the glint on the water. */
  player: 0xffe6b8,
  /** Crest water: green-lit shallow, not cyan. */
  accent: 0x3f9aa4,
  shadow: 0x143243,
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
