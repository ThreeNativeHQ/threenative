// Generated for you. Keep these six palette roles coherent when you change the look.
//
// Natural light, not pastel: every value below is a surface colour under a real sun, so an
// albedo that is plausible in isolation still sits in the same exposure as its neighbours.
// `skyLow`/`skyHigh` are the sky photograph's own two tones, sampled from the HDR it was made
// from, so the horizon the fog fades into is the horizon the frame actually shows.
export const palette = {
  /** The sky photograph's horizon — the fog colour, the water's far body, the loading screen. */
  skyLow: 0xacb1c1,
  /** One stop brighter: the zenith, and the water's own reflected highlight. */
  skyHigh: 0xc3d2e4,
  /** Sunlit grass: the island top, the tufts, the ground the flag island is made of. */
  grass: 0x5f8f3e,
  /** Dry sand: the beach, the footpath, the far sandbar's rim. */
  sand: 0xd9c9a3,
  /** Wet granite: the boulders, the columns under the ledge, the horizon ridge. */
  rock: 0x7d8084,
  /** The one saturated colour: anything you can push, pick up or stand on. */
  accent: 0x2a6cf0,
} as const;

export const COAST_WAVES = [
  { amplitude: 0.12, direction: [1, 0.2] as const, speed: 0.52, wavelength: 7.2 },
  { amplitude: 0.055, detail: true, direction: [-0.35, 1] as const, speed: 0.3, wavelength: 3.3 },
] as const;

export const COAST_DOMAIN_WARP = [
  { amplitude: 0.12, direction: [0.65, -0.35] as const, speed: 0.18, wavelength: 11 },
] as const;
