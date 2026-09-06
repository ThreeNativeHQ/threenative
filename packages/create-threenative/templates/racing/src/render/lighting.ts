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
//
// The sun is **near-white**, not the accent colour. Tinting the key light yellow was how the first
// version of this file made a green infield go olive and a grey road go brown: a strongly coloured
// key contaminates every surface at once, and no per-material tweak can undo it. Colour belongs in
// the materials; the sun's job is direction and contrast.
export function setupLighting(scene: Scene, renderer: ShadowRenderer): DirectionalLight {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  // Sky above, grass bounce below. The ground term is what stops undersides going to slate.
  scene.add(new HemisphereLight(palette.skyLow, palette.field, 1.1));
  const key = new DirectionalLight(0xfff4e2, 2.9);
  key.position.set(-16, 26, -12);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 120;
  key.shadow.camera.left = -55;
  key.shadow.camera.right = 55;
  key.shadow.camera.top = 55;
  key.shadow.camera.bottom = -55;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.03;
  scene.add(key);
  // A cool fill from the opposite side, so shadow faces separate from each other rather than all
  // collapsing to one flat tone.
  const rim = new DirectionalLight(palette.skyLow, 0.85);
  rim.position.set(18, 9, 22);
  scene.add(rim);
  scene.add(new AmbientLight(palette.shadow, 0.55));

  return key;
}
