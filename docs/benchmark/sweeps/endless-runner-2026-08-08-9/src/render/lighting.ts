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
  scene.add(new HemisphereLight(palette.sun, palette.road, 2.2));

  const key = new DirectionalLight(palette.sun, 3.5);
  key.position.set(-7, 14, 8);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 65;
  key.shadow.camera.left = -14;
  key.shadow.camera.right = 14;
  key.shadow.camera.top = 22;
  key.shadow.camera.bottom = -8;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.035;
  scene.add(key);

  const rim = new DirectionalLight(palette.coral, 1.25);
  rim.position.set(6, 5, -10);
  scene.add(rim);
  scene.add(new AmbientLight(palette.sky, 0.42));
}
