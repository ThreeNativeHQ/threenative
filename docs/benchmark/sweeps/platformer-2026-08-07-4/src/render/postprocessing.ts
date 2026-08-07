import { ACESFilmicToneMapping, PCFSoftShadowMap, SRGBColorSpace } from "three";

interface RenderSettings {
  outputColorSpace?: string;
  shadowMap?: { enabled: boolean; type: number };
  toneMapping?: number;
  toneMappingExposure?: number;
}

export function setupPost(rawRenderer: unknown): void {
  const renderer = rawRenderer as RenderSettings;
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  if (renderer.shadowMap) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
  }
}
