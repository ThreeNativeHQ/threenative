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
  key.position.copy(SUN_DIRECTION).multiplyScalar(30);
  key.castShadow = true;
  // One map fitted to the vault: 4096² is under 2 cm a texel across its 12 m span, so every crate
  // casts the same softness. Camera-centred cascades (`VirtualShadowNode`) are for open worlds.
  const size = mobile ? 2048 : 4096;
  key.shadow.mapSize.set(size, size);
  key.shadow.radius = 2;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 80;
  // Half the vault's diagonal. Wider and the texels it spends outside the walls are spent on
  // nothing, and the shadow under a crate is where the player reads that a crate is *on* the floor.
  const extent = 8;
  key.shadow.camera.left = -extent;
  key.shadow.camera.right = extent;
  key.shadow.camera.top = extent;
  key.shadow.camera.bottom = -extent;
  // Small biases: a large normal bias is what lifted a crate's shadow off the floor it rests on.
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.005;
  scene.add(key);
  // The key light is returned because `WorldEnvironment`'s godrays stage raymarches against its
  // shadow map, so `setupPost` needs the light itself.
  return { key };
}
