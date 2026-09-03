import {
  AmbientLight,
  DirectionalLight,
  HemisphereLight,
  PCFSoftShadowMap,
  type Scene,
} from "three";
import { palette } from "./palette.js";

type ShadowRenderer = { shadowMap: { enabled: boolean; type: number } };

/**
 * Key, fill, rim, ambient — named, so each one can be changed on its own.
 *
 * An indoor contraption room lives or dies on contact shadows: the player has to see that a crate
 * is *on* the floor and that the ball is *touching* the ramp, or every physical judgement becomes
 * a guess. So the key is hard, with a tight shadow frustum.
 *
 * It is also nearly overhead, and that was a fix rather than a preference. A key at fifteen
 * degrees off the horizon threw the left wall across half the play area, and the first capture
 * had a black floor on one side and a legible one on the other — the room looked broken. In an
 * interior with walls this tall, the key belongs above the room and the fill has to be strong
 * enough that its shadow still has a readable floor inside it.
 *
 * Returns the key light: `WorldEnvironment`'s godrays stage raymarches against a shadow map, so
 * the scene hands the sun to `setupPost` and a shadowless light is refused by name instead of
 * rendering a black pass.
 */
export function setupLighting(scene: Scene, renderer: ShadowRenderer): DirectionalLight {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  scene.add(new HemisphereLight(palette.skyLow, palette.floor, 2.4));

  const key = new DirectionalLight(0xfff2dd, 3);
  key.position.set(-4, 24, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 70;
  key.shadow.camera.left = -18;
  key.shadow.camera.right = 18;
  key.shadow.camera.top = 18;
  key.shadow.camera.bottom = -18;
  key.shadow.normalBias = 0.035;
  scene.add(key);

  // Cool, from behind and low: it separates the steel and the wall tops from the dark beyond the
  // room without adding a second set of shadows to read.
  const rim = new DirectionalLight(palette.skyLow, 1.3);
  rim.position.set(9, 5, -14);
  scene.add(rim);
  scene.add(new AmbientLight(palette.skyLow, 0.5));

  return key;
}
