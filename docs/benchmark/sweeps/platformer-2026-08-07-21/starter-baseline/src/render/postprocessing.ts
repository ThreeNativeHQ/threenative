// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
import { ACESFilmicToneMapping } from "three";

export function setupPost(renderer: { toneMapping?: number; toneMappingExposure?: number }): void {
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
}
