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
  // The ground term is a muted sea blue, not the trough colour. Bounced at full saturation it
  // painted the ship's shadow side the same teal as the water and the hull stopped reading as
  // timber at all.
  scene.add(new HemisphereLight(palette.skyLow, 0x3d6274, 1.05));

  // Near-white, not the accent. A strongly tinted key contaminates the canvas, the timber and the
  // sea at once, and no per-material tweak can pull them back apart.
  const key = new DirectionalLight(0xfff4e0, 2.9);
  key.position.set(9, 13, 5);
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

  const rim = new DirectionalLight(palette.skyLow, 0.7);
  rim.position.set(-8, 4, -10);
  scene.add(rim);
  scene.add(new AmbientLight(palette.shadow, 0.5));
  return key;
}
