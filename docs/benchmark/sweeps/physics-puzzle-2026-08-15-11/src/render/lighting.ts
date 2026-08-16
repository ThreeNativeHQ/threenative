// Generated for you. This is ordinary Three.js — edit or delete it freely.
//
// An interior at night: one soft key from above-left doing the shadows, a cool
// fill so the dark half of every crate is still readable, and almost no
// ambient. The warm pools come from the lantern point lights in room.ts and the
// cold pool from the goal pad — those are props, not rig lights, so they move
// when the props move.
import { AmbientLight, DirectionalLight, HemisphereLight, PCFSoftShadowMap, type Scene } from "three";

type ShadowRenderer = { shadowMap: { enabled: boolean; type: number } };

export function setupLighting(scene: Scene, renderer: ShadowRenderer): void {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  scene.add(new HemisphereLight(0x54688a, 0x0d1220, 1.15));

  const key = new DirectionalLight(0xfff0d8, 2.5);
  key.position.set(-9, 16, 9);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 60;
  const extent = 16;
  key.shadow.camera.left = -extent;
  key.shadow.camera.right = extent;
  key.shadow.camera.top = extent;
  key.shadow.camera.bottom = -extent;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.025;
  scene.add(key);

  const fill = new DirectionalLight(0x6d9ad6, 0.7);
  fill.position.set(8, 6, -10);
  scene.add(fill);

  // A weak light from behind the camera so the faces the player actually looks
  // at keep their colour instead of falling to ambient.
  const front = new DirectionalLight(0xbcd2f0, 0.45);
  front.position.set(6, 8, 12);
  scene.add(front);

  scene.add(new AmbientLight(0x33445a, 1.05));
}
