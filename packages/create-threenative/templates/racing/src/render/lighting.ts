// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// One sun. The sky image in `sky.ts` is the fill light — its environment reaches every face the
// sun misses — so there is no hemisphere or ambient light stacked on top to flatten the frame.
import { DirectionalLight, PCFSoftShadowMap, type Scene } from "three";
import { SUN_DIRECTION } from "./sky.js";

type ShadowRenderer = { shadowMap: { enabled: boolean; type: number } };

export function setupLighting(
  scene: Scene,
  renderer: ShadowRenderer,
  mobile = false,
): { key: DirectionalLight } {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  // Warm white, matched by eye to the photographed midday sun against its own sky.
  const key = new DirectionalLight(0xfff1e0, 4.5);
  key.position.copy(SUN_DIRECTION).multiplyScalar(40);
  key.castShadow = true;
  // One map fitted to the whole circuit rather than a cascade that follows the car: the racing line
  // never leaves a 36 m square, so 30 m of extent covers the road, the kerbs and the tyre walls at
  // 4096² — a centimetre a texel, which is what keeps the car's own shadow on the road readable.
  // The treeline at 42 m and beyond is deliberately outside it; a tree's shadow is not what says
  // where the track is.
  const size = mobile ? 2048 : 4096;
  key.shadow.mapSize.set(size, size);
  key.shadow.radius = 2;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 120;
  const extent = 30;
  key.shadow.camera.left = -extent;
  key.shadow.camera.right = extent;
  key.shadow.camera.top = extent;
  key.shadow.camera.bottom = -extent;
  // Small biases: a large normal bias is what lifted the mannequin's shadow off its own feet.
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.005;
  scene.add(key);
  // The key light is returned because `WorldEnvironment`'s godrays stage raymarches against its
  // shadow map, so `setupPost` needs the light itself.
  return { key };
}
