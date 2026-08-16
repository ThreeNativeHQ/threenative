// Midday sun rig. The key is warm and comes from behind-left of the camera, the
// hemisphere fills the shadows with sky blue and grass green bounce, and the rim
// keeps the fox's silhouette off the cliffs behind it.
//
// The key light is returned because the level is ~55 units long and a shadow
// camera tight enough to stay crisp cannot cover that. The scene walks the light
// along with the player each frame.
import {
  AmbientLight,
  DirectionalLight,
  HemisphereLight,
  PCFSoftShadowMap,
  type Scene,
} from "three";
import { palette, tints } from "./palette.js";

type ShadowRenderer = { shadowMap: { enabled: boolean; type: number } };

export interface ISunRig {
  readonly key: DirectionalLight;
  /** Keeps the shadow frustum centred on the action without softening it. */
  readonly track: (x: number, y: number, z: number) => void;
}

export function setupLighting(scene: Scene, renderer: ShadowRenderer): ISunRig {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  scene.add(new HemisphereLight(palette.skyHigh, tints.grassDark, 0.8));

  // Bright enough that a cast shadow is a real change in value. Fill light is
  // what erases shadows; the sun has to beat the sum of everything else.
  const key = new DirectionalLight(0xffeec2, 3.5);
  key.position.set(-13, 11, 9);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 70;
  const extent = 14;
  key.shadow.camera.left = -extent;
  key.shadow.camera.right = extent;
  key.shadow.camera.top = extent;
  key.shadow.camera.bottom = -extent;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.12;
  scene.add(key);
  scene.add(key.target);

  // Cool sky-side rim from behind so rounded silhouettes separate from the
  // cliffs, and a low warm bounce standing in for light off the grass.
  const rim = new DirectionalLight(0x9fd8ff, 0.55);
  rim.position.set(8, 6, -14);
  scene.add(rim);

  const bounce = new DirectionalLight(0xd8ffb0, 0.25);
  bounce.position.set(2, -6, 4);
  scene.add(bounce);

  scene.add(new AmbientLight(0xffffff, 0.3));

  const track = (x: number, y: number, z: number): void => {
    key.position.set(x - 13, y + 11, z + 9);
    key.target.position.set(x, y, z);
    key.target.updateMatrixWorld();
  };

  return { key, track };
}
