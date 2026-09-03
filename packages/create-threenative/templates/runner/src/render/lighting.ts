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
 * A runner is lit from ahead. The key sits low and down-track so it rakes across the obstacles
 * and gives each one a long shadow reaching back toward the player: at speed that shadow arrives
 * before the block does, and it is the only warning the player gets in time to use.
 *
 * Returns the key light: `WorldEnvironment`'s godrays stage raymarches against a shadow map, so
 * the scene hands the sun to `setupPost` and a shadowless light is refused by name instead of
 * rendering a black pass.
 */
export function setupLighting(scene: Scene, renderer: ShadowRenderer): DirectionalLight {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  // The sky half is the *rail* grey, not the horizon orange. Taking the horizon colour flooded
  // the road with it and the track stopped being cool at all.
  scene.add(new HemisphereLight(palette.rail, palette.track, 1.2));

  const key = new DirectionalLight(0xffcf9e, 3.4);
  key.position.set(3, 9, -22);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 90;
  key.shadow.camera.left = -14;
  key.shadow.camera.right = 14;
  key.shadow.camera.top = 14;
  key.shadow.camera.bottom = -14;
  key.shadow.normalBias = 0.03;
  scene.add(key);

  // A fill from behind the camera, and it is the light the first two captures were missing. With
  // only a key from down-track, everything the player looks at is backlit: the runner came back a
  // dark silhouette against the obstacle it was about to hit, which is the one comparison the
  // game asks the player to make.
  const fill = new DirectionalLight(0xbfd4ff, 1.5);
  fill.position.set(-2, 7, 16);
  scene.add(fill);

  const rim = new DirectionalLight(palette.accent, 0.7);
  rim.position.set(-8, 4, 6);
  scene.add(rim);
  scene.add(new AmbientLight(palette.skyHigh, 0.6));

  return key;
}
