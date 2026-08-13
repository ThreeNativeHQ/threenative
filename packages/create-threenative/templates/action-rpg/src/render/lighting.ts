import { AmbientLight, DirectionalLight, PCFSoftShadowMap, type Scene } from "three";
import { palette } from "./palette.js";

type ShadowRenderer = { shadowMap: { enabled: boolean; type: number } };

export function setupLighting(scene: Scene, renderer: ShadowRenderer): void {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  const key = new DirectionalLight(palette.accent, 3.2);
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

  const rim = new DirectionalLight(palette.player, 1.35);
  rim.name = "rim-light";
  rim.position.set(12, 6, -12);
  scene.add(rim);
  scene.add(new AmbientLight(palette.skyHigh, 0.72));
}
