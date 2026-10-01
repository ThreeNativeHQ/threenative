// Generated for you. Keep these six palette roles coherent when you change the look.
//
// `skyLow`/`skyHigh` are the sky photograph's own two tones, measured off `assets/sky.jpg` and
// multiplied back by the 2.5 its HDR range was encoded with (`sky.ts`). That is the whole reason
// the horizon used to be a seam: the dome's pale cyan and the water's haze were chosen apart from
// the picture, and the sea met the sky at two different values. Now the far water fades into the
// photograph's own horizon colour, because that is the colour the photograph is actually there.
export const palette = {
  /** The photograph's horizon band — the fog the sea fades into, and where sea meets sky. */
  skyLow: 0xacb1c1,
  /** One stop brighter: the loading screen's track, and the pale top of the cloud bank. */
  skyHigh: 0xc3d2e4,
  /** Deep water in the troughs. */
  floor: 0x06202f,
  /** The sun's own colour: the key light, and the glint it leaves on the water. */
  player: 0xffe6b8,
  /** Crest water: green-lit shallow, not cyan. The one saturated role. */
  accent: 0x134a5e,
  /** What the sun is behind — the touch controls' plate, and the hull's shadowed timber. */
  shadow: 0x143243,
} as const;
