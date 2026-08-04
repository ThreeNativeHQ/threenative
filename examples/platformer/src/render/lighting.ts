// Yours: ordinary Three.js. ThreeNative does not read this file.
//
// Midday sun over a toy world. Four lights, and the fourth is the one people
// forget: a cool rim from behind so the fox's silhouette separates from a sky
// that is roughly the same brightness as it is.
//
// The shadow camera follows the sun *and the fox* (`aimSun`), because a shadow
// camera tight enough to stay crisp cannot also cover a forty-metre level.
import {
  AmbientLight,
  DirectionalLight,
  HemisphereLight,
  PCFSoftShadowMap,
  type Scene,
  type Vector3,
} from "three";
import { palette } from "./palette.js";

type ShadowRenderer = { shadowMap: { enabled: boolean; type: number } };

export interface SunRig {
  /** Slide the shadow frustum along with the player. Call once per frame. */
  readonly aimSun: (target: Vector3) => void;
}

export function setupLighting(scene: Scene, renderer: ShadowRenderer): SunRig {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  // Sky above, grass bounce below. Tinting the second colour toward the ground
  // the level is actually made of is the cheapest realism in the whole rig.
  scene.add(new HemisphereLight(palette.skyLow, palette.grassDark, 0.95));

  const key = new DirectionalLight(palette.sun, 3.6);
  key.position.set(9, 14, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 70;
  const extent = 22;
  key.shadow.camera.left = -extent;
  key.shadow.camera.right = extent;
  key.shadow.camera.top = extent;
  key.shadow.camera.bottom = -extent;
  key.shadow.bias = -0.0006;
  // Rounded geometry self-shadows at grazing angles without this, and the bias
  // alone would have to grow big enough to detach contact shadows.
  key.shadow.normalBias = 0.035;
  scene.add(key);
  scene.add(key.target);

  const rim = new DirectionalLight(palette.skyLow, 1.1);
  rim.position.set(-8, 5, -9);
  scene.add(rim);

  scene.add(new AmbientLight(0xffffff, 0.22));

  const aimSun = (target: Vector3): void => {
    key.position.set(target.x + 9, target.y + 14, target.z + 7);
    key.target.position.copy(target);
    key.target.updateMatrixWorld();
  };

  return { aimSun };
}
