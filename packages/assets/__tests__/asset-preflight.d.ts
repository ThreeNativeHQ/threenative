/**
 * The surface of `packages/runtime-native/scripts/asset-preflight.mjs` these tests read.
 *
 * The preflight is a plain `.mjs` build script with no types of its own and it is not this lane's
 * to change, so its shape is declared here — by wildcard, because a relative specifier cannot be
 * the subject of `declare module`. Only what the audio specs use is named: the container table and
 * the sniff, which they read so that a decoder list drifting apart from the pass that produces the
 * bytes fails a test instead of shipping a silent asset.
 */
declare module "*/asset-preflight.mjs" {
  /** Containers `decodeAudioFile` implements, and therefore what every native target decodes. */
  export const NATIVE_AUDIO_CONTAINERS: readonly string[];
  /** What the file is, read from its bytes rather than its extension. */
  export function detectAudioContainer(bytes: Uint8Array): string;
}
