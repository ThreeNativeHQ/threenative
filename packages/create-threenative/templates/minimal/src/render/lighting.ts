// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
import { AmbientLight, DirectionalLight, HemisphereLight, type Scene } from "three";

export function setupLighting(scene: Scene): void {
  scene.add(new HemisphereLight(0x7cc7e8, 0x071019, 1.8));
  const key = new DirectionalLight(0xffffff, 3.5);
  key.position.set(4, 7, 3);
  key.castShadow = true;
  scene.add(key);
  scene.add(new AmbientLight(0x174d69, 0.8));
}
