// Generated for you. Keep the key, rim, and fill balanced with your new palette.
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
  // First person puts the player inside the arena rather than above it, so the sky term does
  // most of the work of making a wall read as a surface instead of a silhouette.
  scene.add(new HemisphereLight(palette.skyHigh, palette.skyLow, 1.9));

  const key = new DirectionalLight(palette.accent, 3.1);
  key.name = "key-light";
  key.position.set(-6, 10, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 70;
  key.shadow.camera.left = -20;
  key.shadow.camera.right = 20;
  key.shadow.camera.top = 20;
  key.shadow.camera.bottom = -20;
  key.shadow.bias = -0.0008;
  key.shadow.normalBias = 0.035;
  scene.add(key);

  const rim = new DirectionalLight(palette.player, 1.05);
  rim.name = "rim-light";
  rim.position.set(8, 5, -10);
  scene.add(rim);
  scene.add(new AmbientLight(palette.skyLow, 0.55));

  return key;
}
