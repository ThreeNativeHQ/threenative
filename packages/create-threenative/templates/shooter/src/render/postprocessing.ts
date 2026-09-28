// Generated for you: ordinary Three.js; ThreeNative does not read this file.
//
// ACES rolls highlights off gently, which is the only reason a whitewashed wall
// under a 2.55-intensity key can stay a wall instead of a hole in the frame.
// The exposure is tuned with `lighting.ts` and `sky.ts` as one setting: raising
// it here is the same edit as raising the sun, and the sunlit plaster in the
// captures sits just under clipping at 0.95.
import { ACESFilmicToneMapping } from "three";
type OutputRenderer = {
  raw: unknown;
};

export function setupPost(renderer: OutputRenderer): void {
  const raw = renderer.raw as { toneMapping?: number; toneMappingExposure?: number };
  raw.toneMapping = ACESFilmicToneMapping;
  raw.toneMappingExposure = 0.95;
}
