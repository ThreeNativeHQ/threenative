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
  scene.add(new HemisphereLight(palette.skyHigh, palette.shadow, 1.4));

  const key = new DirectionalLight(palette.accent, 3.2);
  key.position.set(5, 8, 4);
  key.castShadow = true;
  // 1024² is one quarter of a 2048² map's texel storage and fill work. The
  // 24-unit extent covers the generated opening route; widen both together
  // when a larger level needs more shadow coverage, accepting softer shadows.
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 80;
  const extent = 24;
  key.shadow.camera.left = -extent;
  key.shadow.camera.right = extent;
  key.shadow.camera.top = extent;
  key.shadow.camera.bottom = -extent;
  key.shadow.normalBias = 0.04;
  scene.add(key);

  const rim = new DirectionalLight(palette.skyLow, 0.9);
  rim.position.set(-5, 4, -7);
  scene.add(rim);
  scene.add(new AmbientLight(palette.shadow, 0.24));
}
