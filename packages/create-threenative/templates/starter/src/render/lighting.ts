// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
import { AmbientLight, DirectionalLight, HemisphereLight, type Scene } from "three";

type ShadowRenderer = { shadowMap: { enabled: boolean } };

export function setupLighting(scene: Scene, renderer: ShadowRenderer): void {
  renderer.shadowMap.enabled = true;
  scene.add(new HemisphereLight(0x7cc7e8, 0x071019, 1.8));
  const key = new DirectionalLight(0xffffff, 3.5);
  key.position.set(4, 7, 3);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  scene.add(key);
  const fill = new AmbientLight(0x174d69, 0.8);
  scene.add(fill);
}
