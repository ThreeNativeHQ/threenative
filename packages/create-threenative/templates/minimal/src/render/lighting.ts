// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// Key, bounce, rim, ambient. The rim is the one people forget: without a cool
// back light, silhouettes read as flat cut-outs against the background.
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

  scene.add(new HemisphereLight(palette.skyHigh, palette.shadow, 1.6));

  const key = new DirectionalLight(palette.accent, 3);
  key.position.set(4, 7, 3);
  key.castShadow = true;
  // 1024² keeps the default shadow pass at one quarter of a 2048² map's
  // texel storage and fill work. The small generated scene fits this 12-unit
  // extent; widen it when the playable area grows, accepting softer shadows.
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 60;
  const extent = 12;
  key.shadow.camera.left = -extent;
  key.shadow.camera.right = extent;
  key.shadow.camera.top = extent;
  key.shadow.camera.bottom = -extent;
  key.shadow.bias = -0.0008;
  key.shadow.normalBias = 0.03;
  scene.add(key);

  const rim = new DirectionalLight(palette.player, 0.75);
  rim.position.set(-5, 3, -6);
  scene.add(rim);

  scene.add(new AmbientLight(palette.shadow, 0.28));
}
