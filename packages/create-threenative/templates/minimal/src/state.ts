export type GameState = {
  playerX: number;
  score: number;
  sunAzimuth: number;
  sunElevation: number;
  /** Red channel of the atmosphere's sun transmittance; stays 0 when no atmosphere is built. */
  sunTransmittanceRed: number;
  /** Approximate visible-pixel coverage reported by the opt-in surfel solve. */
  giCoverage: number;
  /** GPU-integrated indirect-light sample containing the game-owned wall colour. */
  giBounceRed: number;
  /** Absolute red-channel change between the settled pre- and post-recolour GPU samples. */
  giBounceDeltaRed: number;
};
