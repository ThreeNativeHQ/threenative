// Ordinary Three.js. Everything a screenshot shows lives here, in the game.
import { AmbientLight, DirectionalLight, Group, HemisphereLight, Object3D } from "three";

type ShadowRenderer = { shadowMap: { enabled: boolean } };

/**
 * Midday key light plus a sky/ground bounce. The sun and its target ride in one
 * group so the scene can slide the whole rig along with the fox: a shadow
 * camera tight enough to stay crisp cannot also cover the length of the level.
 */
export function createLighting(renderer: ShadowRenderer): Group {
  renderer.shadowMap.enabled = true;

  const rig = new Group();
  rig.add(new HemisphereLight(0x9fd9ff, 0x3f7a2e, 1.5));
  rig.add(new AmbientLight(0xffffff, 0.35));

  const sun = new DirectionalLight(0xfff2d2, 2.6);
  sun.position.set(-14, 26, 16);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 80;
  sun.shadow.bias = -0.0012;
  const aim = new Object3D();
  sun.target = aim;
  rig.add(sun, aim);
  return rig;
}
