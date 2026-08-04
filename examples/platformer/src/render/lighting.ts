// Ordinary Three.js. Everything a screenshot shows lives here, in the game.
import {
  AmbientLight,
  DirectionalLight,
  Group,
  HemisphereLight,
  Object3D,
  PCFSoftShadowMap,
} from "three";

type ShadowRenderer = { shadowMap: { enabled: boolean; type: number } };

/**
 * Midday key light, a sky/ground bounce, and a cool rim from behind.
 *
 * The rim is what stops the fox and the props reading as flat cut-outs against
 * the sky — it is 20 lines of the difference between "some boxes" and the
 * reference. The sun and its target ride in one group so the scene can slide
 * the whole rig along with the fox: a shadow camera tight enough to stay crisp
 * cannot also cover the length of the level.
 */
export function createLighting(renderer: ShadowRenderer): Group {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  const rig = new Group();
  rig.add(new HemisphereLight(0xbfe6ff, 0x5f8a3f, 1.5));
  rig.add(new AmbientLight(0xffffff, 0.32));

  const sun = new DirectionalLight(0xfff2d6, 2.5);
  sun.position.set(-14, 26, 16);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 80;
  sun.shadow.bias = -0.0008;
  // Rounded geometry self-shadows at grazing angles without this; the bias
  // alone would have to be large enough to detach contact shadows.
  sun.shadow.normalBias = 0.03;
  const aim = new Object3D();
  sun.target = aim;
  rig.add(sun, aim);

  // Cool back light so silhouettes separate from the sky. No shadow: it exists
  // to draw an edge, and a second shadow map would only muddy the first.
  const rim = new DirectionalLight(0x8fd0ff, 0.75);
  rim.position.set(18, 14, -22);
  rig.add(rim);

  return rig;
}
