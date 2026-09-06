import { AmbientLight, DirectionalLight, PCFSoftShadowMap, type Scene } from "three";
import { palette } from "./palette.js";

type ShadowRenderer = { shadowMap: { enabled: boolean; type: number } };

// Returns the key light: `WorldEnvironment`'s godrays stage raymarches against a shadow map, so
// the scene hands the sun to `setupPost` and a shadowless light is refused by name instead of
// rendering a black pass.
export function setupLighting(scene: Scene, renderer: ShadowRenderer): DirectionalLight {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  // Warm, but not the accent itself: keyed with the trim colour, the stone, the hero and the loot
  // all took the same gold cast and the dungeon lost every distinction between them.
  const key = new DirectionalLight(0xffe0b0, 2.6);
  key.name = "key-light";
  key.position.set(-8, 12, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 70;
  key.shadow.camera.left = -24;
  key.shadow.camera.right = 24;
  key.shadow.camera.top = 20;
  key.shadow.camera.bottom = -20;
  key.shadow.bias = -0.0008;
  key.shadow.normalBias = 0.04;
  scene.add(key);

  const rim = new DirectionalLight(palette.player, 0.9);
  rim.name = "rim-light";
  rim.position.set(12, 6, -12);
  scene.add(rim);
  scene.add(new AmbientLight(0x6a5a48, 1.5));

  return key;
}
