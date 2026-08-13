import {
  AmbientLight,
  DirectionalLight,
  HemisphereLight,
  PCFSoftShadowMap,
  type Scene,
} from "three";
import { palette } from "./palette.js";

type ShadowRenderer = { shadowMap: { enabled: boolean; type: number } };

export function setupLighting(scene: Scene, renderer: ShadowRenderer): void {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  scene.add(new HemisphereLight(palette.skyLow, palette.shadow, 1.2));
  const key = new DirectionalLight(palette.accent, 3.4);
  key.position.set(-8, 18, 10);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 80;
  key.shadow.camera.left = -26;
  key.shadow.camera.right = 26;
  key.shadow.camera.top = 26;
  key.shadow.camera.bottom = -26;
  key.shadow.normalBias = 0.04;
  scene.add(key);
  const rim = new DirectionalLight(palette.skyLow, 1.15);
  rim.position.set(12, 8, -14);
  scene.add(rim);
  scene.add(new AmbientLight(palette.shadow, 0.25));
}
