// Generated for you. This is ordinary Three.js; tune the key and rim for your sea.
import {
  AmbientLight,
  DirectionalLight,
  HemisphereLight,
  PCFSoftShadowMap,
  type Scene,
} from "three";
import { palette } from "./palette.js";

type ShadowRenderer = { shadowMap: { enabled: boolean; type: number } };

export function setupLighting(scene: Scene, renderer: ShadowRenderer): DirectionalLight {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  scene.add(new HemisphereLight(palette.skyHigh, palette.shadow, 1.8));

  const key = new DirectionalLight(palette.player, 3.2);
  key.position.set(6, 10, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 80;
  key.shadow.camera.left = -30;
  key.shadow.camera.right = 30;
  key.shadow.camera.top = 30;
  key.shadow.camera.bottom = -30;
  key.shadow.normalBias = 0.04;
  scene.add(key);

  const rim = new DirectionalLight(palette.accent, 1.1);
  rim.position.set(-8, 4, -10);
  scene.add(rim);
  scene.add(new AmbientLight(palette.shadow, 0.3));
  return key;
}
