// Ordinary Three.js. ThreeNative does not read this file.
//
// The vault is a dark room with two light sources that disagree: warm lantern
// light on one side, cold goal light on the other. The directional key is kept
// dim and warm — it exists to cast the crate shadows, not to light the room.
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

  scene.add(new HemisphereLight(palette.stone, palette.skyLow, 1.5));

  const key = new DirectionalLight(0xffd9a8, 3.1);
  key.position.set(-7, 12, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 48;
  const extent = 13;
  key.shadow.camera.left = -extent;
  key.shadow.camera.right = extent;
  key.shadow.camera.top = extent;
  key.shadow.camera.bottom = -extent;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.03;
  scene.add(key);

  // Cold rim from the goal side so crate silhouettes separate from the floor.
  const rim = new DirectionalLight(palette.goal, 0.6);
  rim.position.set(8, 4, -7);
  scene.add(rim);

  scene.add(new AmbientLight(0x33405e, 2.0));
}
