// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// One sun. The sky image in `sky.ts` is the fill light — its environment reaches every face the
// sun misses and puts the sky's own highlight on every silhouette — so there is no hemisphere,
// ambient or rim light stacked on top to flatten the frame.
import { DirectionalLight, PCFSoftShadowMap, type Scene } from "three";
import { SUN_DIRECTION } from "./sky.js";

type ShadowRenderer = { shadowMap: { enabled: boolean; type: number } };

// Returns the key light: `WorldEnvironment`'s godrays stage raymarches against a shadow map, so
// the scene hands the sun to `setupPost` and a shadowless light is refused by name instead of
// rendering a black pass.
export function setupLighting(scene: Scene, renderer: ShadowRenderer): DirectionalLight {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  // Warm white, matched by eye to the photographed midday sun against its own sky.
  const key = new DirectionalLight(0xfff1e0, 4.5);
  key.position.copy(SUN_DIRECTION).multiplyScalar(30);
  key.castShadow = true;
  // 2048² over the 22 m route is under a centimetre a texel. Widen the extent when the level
  // grows, accepting softer shadows, or follow the player with a `VirtualShadowNode` — the
  // starter's `AGENTS.md` shows how.
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 80;
  const extent = 11;
  key.shadow.camera.left = -extent;
  key.shadow.camera.right = extent;
  key.shadow.camera.top = extent;
  key.shadow.camera.bottom = -extent;
  // Small biases: a large normal bias is what lifted the mannequin's shadow off its own feet.
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.005;
  scene.add(key);
  // In the scene, so a camera-following shadow (`VirtualShadowNode`) can aim at it.
  scene.add(key.target);
  return key;
}
