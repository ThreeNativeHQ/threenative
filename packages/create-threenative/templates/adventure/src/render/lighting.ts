// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// One low, warm sun ahead of the hero. The sky image in `sky.ts` is the fill light, so there is no
// hemisphere or ambient light stacked on top to flatten the frame. The shadow window follows the
// hero: 68 m across on a 4096 map is under two centimetres a texel, so the canopy's shafts have a
// crisp edge and the hero's own shadow stays attached to the boots.
import { DirectionalLight, Object3D, PCFSoftShadowMap, type Scene } from "three";
import { palette } from "./palette.js";
import { SUN_DIRECTION } from "./sky.js";

type ShadowRenderer = { shadowMap: { enabled: boolean; type: number } };

const EXTENT = 34;
const SUN_DISTANCE = 120;

export interface ISun {
  readonly key: DirectionalLight;
  /** Keep the shadow window over the hero. */
  readonly follow: (x: number, z: number) => void;
}

export function setupLighting(scene: Scene, renderer: ShadowRenderer, mobile = false): ISun {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  const key = new DirectionalLight(palette.sun, 6.2);
  key.position.copy(SUN_DIRECTION).multiplyScalar(SUN_DISTANCE);
  key.castShadow = true;
  const size = mobile ? 2048 : 4096;
  key.shadow.mapSize.set(size, size);
  key.shadow.radius = 2;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = SUN_DISTANCE * 2.5;
  key.shadow.camera.left = -EXTENT;
  key.shadow.camera.right = EXTENT;
  key.shadow.camera.top = EXTENT;
  key.shadow.camera.bottom = -EXTENT;
  // Small biases: a large normal bias is what lifts a model's shadow off its own feet.
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.03;
  scene.add(key);
  // The light's target is the origin by default, so a directional light that never moves casts one
  // fixed set of shadows across the whole map. It is added to the scene because three only updates
  // a light target that is in the graph.
  const target = new Object3D();
  scene.add(target);
  key.target = target;
  return {
    key,
    follow: (x, z) => {
      target.position.set(x, 0, z);
      target.updateMatrixWorld();
      key.position.set(
        x + SUN_DIRECTION.x * SUN_DISTANCE,
        SUN_DIRECTION.y * SUN_DISTANCE,
        z + SUN_DIRECTION.z * SUN_DISTANCE,
      );
    },
  };
}
