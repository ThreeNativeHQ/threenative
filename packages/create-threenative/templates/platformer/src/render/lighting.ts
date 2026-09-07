import {
  AmbientLight,
  DirectionalLight,
  HemisphereLight,
  PCFSoftShadowMap,
  type Scene,
} from "three";
import { palette } from "./palette.js";

type ShadowRenderer = { shadowMap: { enabled: boolean; type: number } };

// Returns the key light: `WorldEnvironment`'s godrays stage raymarches against a shadow map, so
// the scene hands the sun to `setupPost` and a shadowless light is refused by name instead of
// rendering a black pass.
export function setupLighting(scene: Scene, renderer: ShadowRenderer): DirectionalLight {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  scene.add(new HemisphereLight(palette.skyLow, palette.ground, 0.5));

  // Warm white, not the accent. Keyed with a saturated yellow, the grass, the character and the
  // stone all took the same cast and the palette collapsed towards one pale band — the same
  // failure the fog note in `sky.ts` describes, arriving through the light instead.
  const key = new DirectionalLight(0xfff2d8, 2.1);
  key.position.set(5, 8, 4);
  key.castShadow = true;
  // 1024² is one quarter of a 2048² map's texel storage and fill work. The
  // 24-unit extent covers the generated opening route; widen both together
  // when a larger level needs more shadow coverage, accepting softer shadows.
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 80;
  const extent = 24;
  key.shadow.camera.left = -extent;
  key.shadow.camera.right = extent;
  key.shadow.camera.top = extent;
  key.shadow.camera.bottom = -extent;
  key.shadow.normalBias = 0.04;
  scene.add(key);

  const rim = new DirectionalLight(palette.skyLow, 0.45);
  rim.position.set(-5, 4, -7);
  scene.add(rim);
  scene.add(new AmbientLight(palette.skyLow, 0.42));

  return key;
}
